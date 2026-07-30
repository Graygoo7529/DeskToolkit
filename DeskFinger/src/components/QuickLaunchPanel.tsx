import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { api, dropItemName, inferKind, kindLabel, uid } from "../api";
import { useFileDrop } from "../hooks/useFileDrop";
import { KIND_ICON, type ItemKind, type LaunchItem, type Project } from "../types";
import ItemModal from "./ItemModal";
import Modal from "./Modal";
import OneClickPanel from "./OneClickPanel";

interface PanelProps {
  project: Project;
  onChange: (p: Project) => void;
  notify: (msg: string) => void;
}

type SortMode = "custom" | "name" | "kind";
type ViewMode = "cards" | "rows";

const KIND_ORDER: ItemKind[] = ["folder", "app", "file", "command", "web"];

const KIND_GROUP_LABEL: Record<ItemKind, string> = {
  folder: "文件夹",
  app: "应用程序",
  file: "文档文件",
  command: "终端命令",
  web: "网页",
};

/** 快速启动：指向项目资源（文件夹 / 应用 / 文档 / 网页）的链接卡片，不拷贝资源本身 */
export default function QuickLaunchPanel({ project, onChange, notify }: PanelProps) {
  const [editor, setEditor] = useState<{ item?: LaunchItem } | null>(null);
  const [oneClickOpen, setOneClickOpen] = useState(false);
  const [sort, setSort] = useState<SortMode>("custom");
  const [view, setView] = useState<ViewMode>("cards");
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  /** 拖动时跟随鼠标的容影位置 */
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null);
  /** 拖动结束后抑制紧随的 click（避免误启动条目） */
  const suppressClick = useRef(false);

  // 拖动中全局切换抓取光标
  useEffect(() => {
    document.body.classList.toggle("reordering", dragId !== null);
    return () => document.body.classList.remove("reordering");
  }, [dragId]);

  const addPaths = async (paths: string[]) => {
    const items: LaunchItem[] = [];
    let skipped = 0;
    for (const path of paths) {
      const fsKind = await api.pathKind(path).catch(() => "missing" as const);
      if (fsKind === "missing") {
        skipped++;
        continue;
      }
      const kind = inferKind(path, fsKind);
      items.push({ id: uid(), kind, name: dropItemName(path, kind), path, args: "", shell: "cmd", keepOpen: true, enabled: true });
    }
    if (items.length > 0) {
      onChange({ ...project, quickLinks: [...project.quickLinks, ...items] });
      notify(`已添加 ${items.length} 个快速启动`);
    }
    if (skipped > 0) notify(`${skipped} 个路径不存在，已跳过`);
  };

  // 一键启动配置浮层打开时，拖入的文件交给浮层（OneClickPanel）处理
  const dragging = useFileDrop((paths) => {
    if (!oneClickOpen) void addPaths(paths);
  });

  const launch = async (item: LaunchItem) => {
    try {
      await api.launchItem(item);
    } catch (e) {
      notify(`启动失败：${e}`);
    }
  };

  const remove = (id: string) =>
    onChange({ ...project, quickLinks: project.quickLinks.filter((i) => i.id !== id) });

  const saveItem = (item: LaunchItem) => {
    const exists = project.quickLinks.some((i) => i.id === item.id);
    const quickLinks = exists
      ? project.quickLinks.map((i) => (i.id === item.id ? item : i))
      : [...project.quickLinks, item];
    onChange({ ...project, quickLinks });
    setEditor(null);
  };

  const addToOneClick = (item: LaunchItem) => {
    onChange({
      ...project,
      oneClick: [...project.oneClick, { ...item, id: uid(), enabled: true }],
    });
    notify(`已加入一键启动：${item.name}`);
  };

  /** 自由排序：把 fromId 移动到 toId 的位置并落盘 */
  const reorder = (fromId: string, toId: string) => {
    if (fromId === toId) return;
    const next = [...project.quickLinks];
    const from = next.findIndex((i) => i.id === fromId);
    const to = next.findIndex((i) => i.id === toId);
    if (from < 0 || to < 0) return;
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    onChange({ ...project, quickLinks: next });
  };

  /**
   * 自由排序的指针拖动实现。
   * 注意：窗口开启了 Tauri 原生文件拖放（dragDropEnabled），Windows 上页面内
   * HTML5 拖放会被拦截（鼠标显示禁止符号），因此这里用 pointer 事件手动实现。
   */
  const startReorderDrag = (e: ReactPointerEvent<HTMLDivElement>, item: LaunchItem) => {
    // 仅自由排序模式、鼠标左键，且不是按在悬浮操作按钮上
    if (sort !== "custom" || e.button !== 0) return;
    if ((e.target as HTMLElement).closest(".link-actions, .row-actions")) return;

    const startX = e.clientX;
    const startY = e.clientY;
    const id = item.id;
    const scroller = document.querySelector(".page-body");
    let active = false;

    const itemIdAt = (x: number, y: number) => {
      const direct = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-item-id]")?.dataset.itemId;
      if (direct) return direct;
      // 指针落在卡片间隙时，取距离最近的卡片作为落点（40px 容差）
      let best: string | null = null;
      let bestDist = Infinity;
      document.querySelectorAll<HTMLElement>("[data-item-id]").forEach((el) => {
        const r = el.getBoundingClientRect();
        const dx = x < r.left ? r.left - x : x > r.right ? x - r.right : 0;
        const dy = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0;
        const d = Math.hypot(dx, dy);
        if (d < bestDist) {
          bestDist = d;
          best = el.dataset.itemId ?? null;
        }
      });
      return bestDist <= 40 ? best : null;
    };

    const onMove = (ev: PointerEvent) => {
      if (!active) {
        // 越过阈值才算拖动，避免影响正常点击
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < 6) return;
        active = true;
        setDragId(id);
      }
      setDragPos({ x: ev.clientX, y: ev.clientY });
      const over = itemIdAt(ev.clientX, ev.clientY);
      setOverId(over && over !== id ? over : null);
      // 靠近列表上下边缘时自动滚动
      if (scroller) {
        if (ev.clientY < 140) scroller.scrollTop -= 14;
        else if (ev.clientY > window.innerHeight - 140) scroller.scrollTop += 14;
      }
    };

    const finish = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      if (!active) return;
      const over = itemIdAt(ev.clientX, ev.clientY);
      if (over && over !== id) reorder(id, over);
      setDragId(null);
      setOverId(null);
      setDragPos(null);
      // 抑制拖动结束后紧随的 click，避免误触发启动
      suppressClick.current = true;
      window.setTimeout(() => {
        suppressClick.current = false;
      }, 0);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
  };

  /** 拖动中与落点的视觉反馈类名 */
  const dragClass = (item: LaunchItem) =>
    `${dragId === item.id ? " drag-src" : ""}${overId === item.id && dragId !== item.id ? " drop-target" : ""}`;

  /** 悬浮操作按钮（卡片 / 列表行共用） */
  const actionButtons = (item: LaunchItem) => (
    <>
      <button className="btn btn-icon btn-sm" title="加入一键启动" onClick={() => addToOneClick(item)}>
        ➕
      </button>
      <button className="btn btn-icon btn-sm" title="编辑" onClick={() => setEditor({ item })}>
        ✎
      </button>
      <button className="btn btn-icon btn-sm btn-danger-ghost" title="移除" onClick={() => remove(item.id)}>
        ✕
      </button>
    </>
  );

  const renderCard = (item: LaunchItem, index: number) => (
    <div
      key={item.id}
      data-item-id={item.id}
      className={`link-card${dragClass(item)}`}
      style={{ animationDelay: `${Math.min(index, 12) * 35}ms` }}
      title={sort === "custom" ? "点击启动，按住拖动可排序" : "点击启动"}
      onClick={() => {
        if (suppressClick.current) return;
        launch(item);
      }}
      onPointerDown={(e) => startReorderDrag(e, item)}
    >
      <div className="link-top">
        <div className="link-icon">{KIND_ICON[item.kind]}</div>
        <div className="link-info">
          <div className="link-name" title={item.name}>
            {item.name}
          </div>
          <div className="link-path dim" title={item.path}>
            {item.path}
          </div>
          <span className="link-kind">{kindLabel(item)}</span>
        </div>
      </div>
      <div className="link-actions" onClick={(e) => e.stopPropagation()}>
        {actionButtons(item)}
      </div>
    </div>
  );

  const renderRow = (item: LaunchItem, index: number) => (
    <div
      key={item.id}
      data-item-id={item.id}
      className={`link-row${dragClass(item)}`}
      style={{ animationDelay: `${Math.min(index, 16) * 25}ms` }}
      title={sort === "custom" ? "点击启动，按住拖动可排序" : "点击启动"}
      onClick={() => {
        if (suppressClick.current) return;
        launch(item);
      }}
      onPointerDown={(e) => startReorderDrag(e, item)}
    >
      <span className="action-icon">{KIND_ICON[item.kind]}</span>
      <span className="row-name">{item.name}</span>
      <span className="row-path dim" title={item.path}>
        {item.path}
      </span>
      <span className="link-kind">{kindLabel(item)}</span>
      <div className="row-actions" onClick={(e) => e.stopPropagation()}>
        {actionButtons(item)}
      </div>
    </div>
  );

  const renderItems = (items: LaunchItem[]) =>
    view === "cards" ? (
      <div className="link-grid">{items.map(renderCard)}</div>
    ) : (
      <div className="link-rows">{items.map(renderRow)}</div>
    );

  const links = project.quickLinks;
  const isEmpty = links.length === 0;

  /** 一键启动配置入口：放在「手动添加」左侧，点击弹出悬浮配置列表 */
  const oneClickButton = (
    <button className="btn" onClick={() => setOneClickOpen(true)} title="配置一键启动项目">
      ⚙ 一键启动
    </button>
  );

  const sortedByName = () => [...links].sort((a, b) => a.name.localeCompare(b.name, "zh-Hans-CN"));

  return (
    <div className="panel">
      {isEmpty ? (
        <div className={`drop-zone ${dragging && !oneClickOpen ? "dragging" : ""}`}>
          <span>📥 将文件、文件夹或应用程序（含快捷方式）拖到这里，即可添加快速启动</span>
          {oneClickButton}
          <button className="btn" onClick={() => setEditor({})}>
            ＋ 手动添加
          </button>
        </div>
      ) : (
        <div className="panel-toolbar">
          <select className="sort-select" value={sort} onChange={(e) => setSort(e.target.value as SortMode)} title="排序方式">
            <option value="custom">自由排序</option>
            <option value="name">按名称排序</option>
            <option value="kind">按类型分组</option>
          </select>
          <div className="mode-switch">
            <button className={`btn btn-sm ${view === "cards" ? "active" : ""}`} onClick={() => setView("cards")} title="卡片视图">
              🗂️ 卡片
            </button>
            <button className={`btn btn-sm ${view === "rows" ? "active" : ""}`} onClick={() => setView("rows")} title="紧凑列表视图">
              ☰ 列表
            </button>
          </div>
          <span className="dim toolbar-hint">
            {sort === "custom"
              ? `${links.length} 个启动项，点击启动，按住拖动可自由排序`
              : `${links.length} 个启动项，点击即可启动，拖入文件可继续添加`}
          </span>
          <div className="spacer" />
          {oneClickButton}
          <button className="btn" onClick={() => setEditor({})}>
            ＋ 手动添加
          </button>
        </div>
      )}

      {sort === "kind" && !isEmpty ? (
        KIND_ORDER.map((k) => {
          const group = links.filter((i) => i.kind === k);
          if (group.length === 0) return null;
          return (
            <section key={k} className="group-section">
              <div className="group-header">
                <span>{KIND_ICON[k]}</span>
                <span>{KIND_GROUP_LABEL[k]}</span>
                <span className="count">{group.length}</span>
              </div>
              {renderItems(group)}
            </section>
          );
        })
      ) : (
        !isEmpty && renderItems(sort === "name" ? sortedByName() : links)
      )}

      {isEmpty && (
        <div className="empty-state small">
          <p>还没有快速启动。拖入项目常用的文件夹、程序或文档试试。</p>
        </div>
      )}

      {dragging && !isEmpty && !oneClickOpen && <div className="drop-overlay">📥 松开鼠标，添加到快速启动</div>}

      {oneClickOpen && (
        <Modal title="▶ 一键启动配置" className="wide" onClose={() => setOneClickOpen(false)}>
          <OneClickPanel project={project} onChange={onChange} notify={notify} />
        </Modal>
      )}

      {editor && (
        <ItemModal
          title={editor.item ? "编辑快速启动" : "添加快速启动"}
          initial={editor.item}
          onSave={saveItem}
          onClose={() => setEditor(null)}
        />
      )}

      {dragId && dragPos && <DragGhost item={links.find((i) => i.id === dragId)} pos={dragPos} />}
    </div>
  );
}

/** 自由排序拖动时跟随鼠标的容影（pointer-events: none，不影响落点命中） */
function DragGhost({ item, pos }: { item?: LaunchItem; pos: { x: number; y: number } }) {
  if (!item) return null;
  return (
    <div className="drag-ghost" style={{ left: pos.x + 14, top: pos.y + 16 }}>
      <span className="drag-ghost-icon">{KIND_ICON[item.kind]}</span>
      <span className="drag-ghost-name">{item.name}</span>
    </div>
  );
}
