import { useState } from "react";
import { api, dropItemName, inferKind, kindLabel, sleep, uid } from "../api";
import { useFileDrop } from "../hooks/useFileDrop";
import { KIND_ICON, type LaunchItem, type Project } from "../types";
import ItemModal from "../components/ItemModal";

interface PanelProps {
  project: Project;
  onChange: (p: Project) => void;
  notify: (msg: string) => void;
}

/** 一键启动：按顺序执行一组动作（打开目录 / 程序 / 文档、执行终端命令） */
export default function OneClickPanel({ project, onChange, notify }: PanelProps) {
  const [editor, setEditor] = useState<{ item?: LaunchItem } | null>(null);
  const [running, setRunning] = useState(false);

  const items = project.oneClick;

  const addPaths = async (paths: string[]) => {
    const added: LaunchItem[] = [];
    for (const path of paths) {
      const fsKind = await api.pathKind(path).catch(() => "missing" as const);
      if (fsKind === "missing") continue;
      const kind = inferKind(path, fsKind);
      added.push({ id: uid(), kind, name: dropItemName(path, kind), path, args: "", shell: "cmd", keepOpen: true, enabled: true });
    }
    if (added.length > 0) {
      onChange({ ...project, oneClick: [...items, ...added] });
      notify(`已添加 ${added.length} 个启动动作`);
    }
  };

  const dragging = useFileDrop(addPaths);

  const update = (next: LaunchItem[]) => onChange({ ...project, oneClick: next });

  const move = (index: number, dir: -1 | 1) => {
    const j = index + dir;
    if (j < 0 || j >= items.length) return;
    const next = [...items];
    [next[index], next[j]] = [next[j], next[index]];
    update(next);
  };

  const saveItem = (item: LaunchItem) => {
    const exists = items.some((i) => i.id === item.id);
    update(exists ? items.map((i) => (i.id === item.id ? item : i)) : [...items, item]);
    setEditor(null);
  };

  const runItem = async (item: LaunchItem) => {
    try {
      await api.launchItem(item);
    } catch (e) {
      notify(`「${item.name}」启动失败：${e}`);
    }
  };

  const runAll = async () => {
    const enabled = items.filter((i) => i.enabled);
    if (enabled.length === 0) return notify("没有已启用的启动项");
    setRunning(true);
    let ok = 0;
    for (const item of enabled) {
      try {
        await api.launchItem(item);
        ok++;
      } catch (e) {
        notify(`「${item.name}」启动失败：${e}`);
      }
      await sleep(450);
    }
    setRunning(false);
    notify(`一键启动完成：${ok}/${enabled.length} 项已执行`);
  };

  return (
    <div className="panel">
      <div className="panel-toolbar">
        <button className="btn btn-primary" onClick={runAll} disabled={running || items.every((i) => !i.enabled)}>
          {running ? "正在执行…" : `▶ 一键启动（${items.filter((i) => i.enabled).length} 项）`}
        </button>
        <button className="btn" onClick={() => setEditor({})}>
          ＋ 添加动作
        </button>
        <span className="dim toolbar-hint">可直接拖入文件 / 文件夹 / 程序追加，或在快速启动卡片上点「➕」加入</span>
      </div>

      <div className={`drop-zone slim ${dragging ? "dragging" : ""}`}>📥 拖入文件即可追加为启动动作</div>

      {items.length === 0 ? (
        <div className="empty-state small">
          <p>还没有启动动作。把每天开工要打开的目录、程序、文档、命令都加进来，一键进入工作状态。</p>
        </div>
      ) : (
        <div className="action-list">
          {items.map((item, index) => (
            <div key={item.id} className={`action-row ${item.enabled ? "" : "disabled"}`}>
              <span className="action-index">{index + 1}</span>
              <span className="action-icon">{KIND_ICON[item.kind]}</span>
              <div className="action-info">
                <div className="action-name">
                  {item.name}
                  <span className="link-kind">{kindLabel(item)}</span>
                </div>
                <div className="link-path dim" title={item.path}>
                  {item.path}
                  {item.args && <code className="args">{item.args}</code>}
                </div>
              </div>
              <label className="action-enabled" title="一键启动时是否执行">
                <input
                  type="checkbox"
                  checked={item.enabled}
                  onChange={(e) => update(items.map((i) => (i.id === item.id ? { ...i, enabled: e.target.checked } : i)))}
                />
                启用
              </label>
              <div className="action-btns">
                <button className="btn btn-sm" title="上移" disabled={index === 0} onClick={() => move(index, -1)}>
                  ↑
                </button>
                <button className="btn btn-sm" title="下移" disabled={index === items.length - 1} onClick={() => move(index, 1)}>
                  ↓
                </button>
                <button className="btn btn-sm btn-primary" title="立即执行" onClick={() => runItem(item)}>
                  ▶
                </button>
                <button className="btn btn-sm" title="编辑" onClick={() => setEditor({ item })}>
                  ✎
                </button>
                <button className="btn btn-sm btn-danger-ghost" title="移除" onClick={() => update(items.filter((i) => i.id !== item.id))}>
                  ✕
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {editor && (
        <ItemModal
          title={editor.item ? "编辑启动动作" : "添加启动动作"}
          initial={editor.item}
          showEnabled
          onSave={saveItem}
          onClose={() => setEditor(null)}
        />
      )}
    </div>
  );
}
