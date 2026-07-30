import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api } from "../api";
import Modal from "./Modal";

type ViewMode = "edit" | "split" | "preview";

interface DocsPanelProps {
  projectId: string;
  notify: (msg: string) => void;
}

/** 项目文档：软件维护的 Markdown 文档，支持实时预览；每个项目默认有「看板.md」 */
export default function DocsPanel({ projectId, notify }: DocsPanelProps) {
  const [docs, setDocs] = useState<string[]>([]);
  const [current, setCurrent] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [saved, setSaved] = useState("");
  const [mode, setMode] = useState<ViewMode>("split");
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const dirty = draft !== saved;
  const draftRef = useRef(draft);
  draftRef.current = draft;

  const loadDocs = useCallback(
    async (select?: string) => {
      try {
        const list = await api.listDocs(projectId);
        setDocs(list);
        const target = select && list.includes(select) ? select : list[0];
        if (target) {
          setCurrent(target);
          const content = await api.readDoc(projectId, target);
          setDraft(content);
          setSaved(content);
        } else {
          setCurrent(null);
          setDraft("");
          setSaved("");
        }
      } catch (e) {
        notify(`加载文档失败：${e}`);
      }
    },
    [projectId, notify]
  );

  useEffect(() => {
    loadDocs();
  }, [loadDocs]);

  const saveNow = useCallback(async () => {
    if (!current || draftRef.current === saved) return;
    try {
      await api.writeDoc(projectId, current, draftRef.current);
      setSaved(draftRef.current);
    } catch (e) {
      notify(`保存失败：${e}`);
    }
  }, [current, saved, projectId, notify]);

  // 自动保存（1s 防抖）
  useEffect(() => {
    if (!dirty || !current) return;
    const t = setTimeout(() => {
      api
        .writeDoc(projectId, current, draftRef.current)
        .then(() => setSaved(draftRef.current))
        .catch((e) => notify(`自动保存失败：${e}`));
    }, 1000);
    return () => clearTimeout(t);
  }, [draft, dirty, current, projectId, notify]);

  const selectDoc = async (name: string) => {
    if (name === current) return;
    await saveNow();
    try {
      const content = await api.readDoc(projectId, name);
      setCurrent(name);
      setDraft(content);
      setSaved(content);
    } catch (e) {
      notify(`打开文档失败：${e}`);
    }
  };

  const onEditorKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Ctrl/Cmd + S 手动保存
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      saveNow();
      return;
    }
    // Tab 插入两个空格
    if (e.key === "Tab") {
      e.preventDefault();
      const el = e.currentTarget;
      const { selectionStart: s, selectionEnd: epos, value } = el;
      const next = value.slice(0, s) + "  " + value.slice(epos);
      setDraft(next);
      requestAnimationFrame(() => el.setSelectionRange(s + 2, s + 2));
    }
  };

  const submitCreate = async () => {
    try {
      const name = await api.createDoc(projectId, nameInput);
      setCreating(false);
      setNameInput("");
      await loadDocs(name);
    } catch (e) {
      notify(`创建失败：${e}`);
    }
  };

  const submitRename = async () => {
    if (!current) return;
    try {
      const name = await api.renameDoc(projectId, current, nameInput);
      setRenaming(false);
      setNameInput("");
      await loadDocs(name);
    } catch (e) {
      notify(`重命名失败：${e}`);
    }
  };

  const submitDelete = async () => {
    if (!current) return;
    try {
      await api.deleteDoc(projectId, current);
      setDeleting(false);
      await loadDocs();
    } catch (e) {
      notify(`删除失败：${e}`);
    }
  };

  return (
    <div className="docs-panel">
      <aside className="docs-side">
        <div className="docs-side-head">
          <span>文档</span>
          <button className="btn btn-sm" title="新建文档" onClick={() => { setNameInput(""); setCreating(true); }}>
            ＋
          </button>
        </div>
        {docs.map((d) => (
          <button key={d} className={`doc-item ${d === current ? "active" : ""}`} onClick={() => selectDoc(d)}>
            <span className="doc-item-icon">{d === "看板.md" ? "📋" : "📄"}</span>
            <span className="doc-item-name">{d}</span>
          </button>
        ))}
        {docs.length === 0 && <div className="dim pad-sm">暂无文档</div>}
      </aside>

      <div className="docs-main">
        {current ? (
          <>
            <div className="docs-toolbar">
              <span className="docs-current" title={current}>
                {current}
              </span>
              <span className={`save-dot ${dirty ? "dirty" : ""}`} title={dirty ? "有未保存修改" : "已保存"} />
              <span className="save-state dim">{dirty ? "未保存" : "已保存"}</span>
              <button className="btn btn-sm" onClick={saveNow} disabled={!dirty} title="立即保存（Ctrl+S）">
                保存
              </button>
              <div className="spacer" />
              <div className="mode-switch">
                {(["edit", "split", "preview"] as ViewMode[]).map((m) => (
                  <button key={m} className={`btn btn-sm ${mode === m ? "active" : ""}`} onClick={() => setMode(m)}>
                    {m === "edit" ? "编辑" : m === "split" ? "分屏" : "预览"}
                  </button>
                ))}
              </div>
              <button className="btn btn-sm" onClick={() => { setNameInput(current.replace(/\.md$/, "")); setRenaming(true); }}>
                重命名
              </button>
              <button className="btn btn-sm btn-danger-ghost" onClick={() => setDeleting(true)}>
                删除
              </button>
            </div>
            <div className={`docs-editor mode-${mode}`}>
              {mode !== "preview" && (
                <textarea
                  className="md-input"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={onEditorKeyDown}
                  placeholder="在这里编写 Markdown…（Ctrl+S 立即保存，Tab 缩进）"
                  spellCheck={false}
                />
              )}
              {mode !== "edit" && (
                <div className="md-preview">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{draft}</ReactMarkdown>
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="empty-state small">
            <p>这个项目还没有文档，点左侧「＋」新建一个吧。</p>
          </div>
        )}
      </div>

      {creating && (
        <Modal
          title="新建文档"
          onClose={() => setCreating(false)}
          footer={
            <>
              <button className="btn" onClick={() => setCreating(false)}>取消</button>
              <button className="btn btn-primary" onClick={submitCreate}>创建</button>
            </>
          }
        >
          <label className="field">
            <span>文档名（自动追加 .md 后缀）</span>
            <input
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              placeholder="例如：会议纪要"
              autoFocus
              onKeyDown={(e) => e.key === "Enter" && submitCreate()}
            />
          </label>
        </Modal>
      )}

      {renaming && (
        <Modal
          title={`重命名「${current}」`}
          onClose={() => setRenaming(false)}
          footer={
            <>
              <button className="btn" onClick={() => setRenaming(false)}>取消</button>
              <button className="btn btn-primary" onClick={submitRename}>保存</button>
            </>
          }
        >
          <label className="field">
            <span>新文档名</span>
            <input
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              autoFocus
              onKeyDown={(e) => e.key === "Enter" && submitRename()}
            />
          </label>
        </Modal>
      )}

      {deleting && (
        <Modal
          title={`删除文档「${current}」`}
          onClose={() => setDeleting(false)}
          footer={
            <>
              <button className="btn" onClick={() => setDeleting(false)}>取消</button>
              <button className="btn btn-danger" onClick={submitDelete}>确认删除</button>
            </>
          }
        >
          <p>文档文件将从运行目录中删除，此操作不可恢复。</p>
        </Modal>
      )}
    </div>
  );
}
