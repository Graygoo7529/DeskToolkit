import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import type { Editor } from "@tiptap/core";
import { colors, createWorkspace, errorText, newNote, uid, type Note, type Workspace } from "./model";
import { changeDirectory, desktop, getStorageState, legacyWorkspace, openNoteFile, preserveAndReload, readWorkspace, SaveQueue, type Loaded } from "./storage";
import DirectoryForm from "./DirectoryForm";
import Modal from "./Modal";
import Icon from "./Icons";
import NoteEditor from "./editor/NoteEditor";

export default function App() {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [workspaceEpoch, setWorkspaceEpoch] = useState(0);
  const workspaceRef = useRef<Workspace | null>(null);
  const pathRef = useRef("");
  const queue = useRef(new SaveQueue());
  const [dataDir, setDataDir] = useState("");
  const [suggested, setSuggested] = useState("");
  const [starting, setStarting] = useState(true);
  const [setup, setSetup] = useState(false);
  const [startupError, setStartupError] = useState("");
  const [oldWorkspace, setOldWorkspace] = useState<Workspace | null>(null);
  const [clusterId, setClusterId] = useState("");
  const [noteId, setNoteId] = useState("");
  const [search, setSearch] = useState("");
  const [source, setSource] = useState(false);
  const [storageOpen, setStorageOpen] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [folderDialog, setFolderDialog] = useState<"new" | "rename" | null>(null);
  const [folderName, setFolderName] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [toast, setToast] = useState("");
  const [saveState, setSaveState] = useState<"saved" | "saving" | "error">("saved");
  const [saveError, setSaveError] = useState("");
  const saveVersion = useRef(0);
  const title = useRef<HTMLInputElement>(null);
  const editor = useRef<Editor | null>(null);
  const closeNeeded = useRef(false);
  const [, setEditorTick] = useState(0);

  const load = useCallback((loaded: Loaded) => {
    workspaceRef.current = loaded.workspace; pathRef.current = loaded.dataDir;
    setWorkspace(loaded.workspace); setDataDir(loaded.dataDir);
    setWorkspaceEpoch(epoch => epoch + 1); setSource(false); setSearch("");
    setClusterId(loaded.workspace.clusters[0].id); setNoteId(loaded.workspace.clusters[0].notes[0]?.id || "");
    setSetup(false); setSaveState("saved"); setSaveError(""); setStartupError("");
    closeNeeded.current = false;
  }, []);
  const start = useCallback(async () => {
    setStarting(true); setStartupError("");
    try {
      const state = await getStorageState();
      setSuggested(state.suggestedDir);
      if (state.dataDir) load(await readWorkspace());
      else { setOldWorkspace(legacyWorkspace()); setSetup(true); }
    } catch (e) { setStartupError(errorText(e)); }
    finally { setStarting(false); }
  }, [load]);
  useEffect(() => { void start(); }, [start]);

  const save = useCallback((next: Workspace) => {
    const version = ++saveVersion.current;
    setSaveState("saving"); setSaveError(""); closeNeeded.current = true;
    void queue.current.save(pathRef.current, next).then(() => {
      if (version === saveVersion.current) { setSaveState("saved"); closeNeeded.current = false; }
    }).catch(e => {
      if (version === saveVersion.current) { setSaveState("error"); setSaveError(errorText(e)); }
    });
  }, []);
  const commit = useCallback((next: Workspace) => {
    workspaceRef.current = next; setWorkspace(next); save(next);
  }, [save]);
  const updateNote = useCallback((changes: Partial<Note>) => {
    const previous = workspaceRef.current;
    if (!previous) return;
    commit({ clusters: previous.clusters.map(c => c.id === clusterId ? {
      ...c, notes: c.notes.map(n => n.id === noteId ? { ...n, ...changes, updatedAt: Date.now() } : n),
    } : c) });
  }, [clusterId, noteId, commit]);
  const updateContent = useCallback((content: string) => updateNote({ content }), [updateNote]);
  const cluster = workspace?.clusters.find(c => c.id === clusterId);
  const note = cluster?.notes.find(n => n.id === noteId);
  const visibleNotes = cluster?.notes.filter(n => !search.trim() || (n.title + "\n" + n.content).toLowerCase().includes(search.trim().toLowerCase())) || [];
  const switchNote = (id: string) => { setNoteId(id); setSource(false); };
  const addNote = useCallback(() => {
    const current = workspaceRef.current;
    if (!current || !clusterId) return;
    const n = newNote();
    commit({ clusters: current.clusters.map(c => c.id === clusterId ? { ...c, notes: [...c.notes, n] } : c) });
    setSearch(""); setSource(false); setNoteId(n.id);
    requestAnimationFrame(() => title.current?.select());
  }, [clusterId, commit]);
  const applyDirectory = async (path: string) => {
    await queue.current.flush();
    const seed = workspaceRef.current || oldWorkspace || createWorkspace();
    const loaded = await changeDirectory(path, seed);
    load(loaded); setStorageOpen(false);
  };
  const reloadFiles = async (preserve = false) => {
    setReloading(true);
    try {
      if (preserve) await queue.current.flush().catch(() => undefined);
      else await queue.current.flush();
      const loaded = preserve && workspaceRef.current
        ? await preserveAndReload(pathRef.current, workspaceRef.current)
        : await readWorkspace();
      queue.current.reset();
      load(loaded);
      const selected = loaded.workspace.clusters.find(c => c.id === clusterId);
      if (selected) { setClusterId(selected.id); setNoteId(selected.notes.some(n => n.id === noteId) ? noteId : selected.notes[0]?.id || ""); }
      setStorageOpen(false);
      setToast(preserve ? "当前版本已另存到数据目录的 .desktodo/drafts，已载入磁盘内容" : "已重新载入 Markdown 文件");
    } catch (e) { setToast("重新载入失败：" + errorText(e)); }
    finally { setReloading(false); }
  };
  const openFile = async () => {
    if (!note) return;
    try { await queue.current.flush(); await openNoteFile(note.id); }
    catch (e) { setToast("打开文件失败：" + errorText(e)); }
  };
  const copy = async () => {
    if (!note) return;
    try { await navigator.clipboard.writeText(note.content); setToast("便签内容已复制"); }
    catch (e) { setToast("复制失败：" + errorText(e)); }
  };
  const submitFolder = () => {
    if (!workspace || !folderName.trim()) return;
    if (folderDialog === "rename") commit({ clusters: workspace.clusters.map(c => c.id === clusterId ? { ...c, name: folderName.trim() } : c) });
    else {
      const c = { id: uid(), name: folderName.trim(), color: colors[workspace.clusters.length % colors.length], icon: "folder", notes: [newNote()] };
      commit({ clusters: [...workspace.clusters, c] }); setClusterId(c.id); setNoteId(c.notes[0].id); setSearch(""); setSource(false);
    }
    setFolderDialog(null);
  };
  const deleteNote = () => {
    if (!workspace || !cluster || !note) return;
    const notes = cluster.notes.filter(n => n.id !== note.id);
    commit({ clusters: workspace.clusters.map(c => c.id === clusterId ? { ...c, notes } : c) });
    setNoteId(notes[0]?.id || ""); setDeleting(false); setSource(false);
  };
  useEffect(() => {
    const timer = window.setTimeout(() => setToast(""), 3000); return () => window.clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.isComposing || setup || storageOpen || folderDialog || deleting || reloading) return;
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "n") { e.preventDefault(); addNote(); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault(); if (workspaceRef.current) save(workspaceRef.current);
      }
    };
    window.addEventListener("keydown", key); return () => window.removeEventListener("keydown", key);
  }, [addNote, save, setup, storageOpen, folderDialog, deleting, reloading]);
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    if (desktop) {
      void import("@tauri-apps/api/window").then(async ({ getCurrentWindow }) => {
        const win = getCurrentWindow();
        const dispose = await win.onCloseRequested(async event => {
          if (!closeNeeded.current) return;
          event.preventDefault();
          try { await queue.current.flush(); closeNeeded.current = false; await win.destroy(); }
          catch (e) { setSaveState("error"); setSaveError("关闭前保存失败：" + errorText(e)); }
        });
        if (cancelled) dispose(); else unlisten = dispose;
      });
    }
    return () => { cancelled = true; unlisten?.(); };
  }, []);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (closeNeeded.current) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn);
  }, []);
  const attachEditor = useCallback((instance: Editor | null) => {
    editor.current = instance;
    if (instance) instance.on("transaction", () => setEditorTick(t => t + 1));
    setEditorTick(t => t + 1);
  }, []);

  if (starting) return <div className="center-screen"><img src="/app-icon.svg" width="56" alt="" /><p>正在打开便签…</p></div>;
  if (startupError) return <div className="center-screen"><div className="setup-card"><h1>暂时无法读取便签</h1><p className="form-error" role="alert">{startupError}</p><p className="hint">原数据已保留。请检查目录是否可用，或从数据目录中的备份恢复。</p><div className="modal-actions">{desktop && <button className="button" onClick={() => setStorageOpen(true)}>选择其他数据目录</button>}<button className="button primary" onClick={() => void start()}>重试</button></div></div>{storageOpen && <Modal title="选择其他数据目录" onClose={() => setStorageOpen(false)}><DirectoryForm suggested={suggested} migrating={false} onApply={applyDirectory} onCancel={() => setStorageOpen(false)} /></Modal>}</div>;
  if (setup) return <div className="center-screen"><div className="setup-card">
    <img className="setup-icon" src="/app-icon.svg" width="74" height="74" alt="DeskTodo" />
    <p className="eyebrow">DESKTODO</p><h1>给想法一个落脚点</h1>
    <p className="setup-copy">一张便签，一点思路。{oldWorkspace ? "检测到旧版便签，选择目录即可迁入。" : "先为你的便签选择一个本地目录。"}</p>
    <DirectoryForm suggested={suggested} migrating={!!oldWorkspace} onApply={applyDirectory} />
  </div></div>;
  if (!workspace || !cluster) return null;
  return <div className="app-shell">
    <header className="topbar"><div className="brand"><img src="/app-icon.svg" width="33" height="33" alt="" /><strong>DeskTodo</strong><span>随手记，慢慢做。</span></div>
      <div className="save-status" role="status" data-state={saveState}><i />{saveState === "saved" ? "已保存" : saveState === "saving" ? "正在保存…" : "未能保存"}</div>
    </header>
    <div className="app-body">
      <aside className="sidebar">
        <div className="sidebar-label"><span>NOTE 夹</span><button className="icon-button" aria-label="新建 note 夹" title="新建 note 夹" onClick={() => { setFolderName(""); setFolderDialog("new"); }}><Icon name="plus" size={16} /></button></div>
        <nav className="folder-list" aria-label="Note 夹">{workspace.clusters.map(c => <button className={"folder" + (c.id === clusterId ? " active" : "")} key={c.id} style={{ "--folder-color": c.color } as CSSProperties} onClick={() => { setClusterId(c.id); switchNote(c.notes[0]?.id || ""); setSearch(""); }}>
          <Icon name="folder" /><span>{c.name}</span><small>{c.notes.length}</small>
        </button>)}</nav>
        <button className="storage-button" onClick={() => setStorageOpen(true)}><Icon name="settings" size={16} /><span>数据目录<small>{desktop ? "保存在此设备" : "浏览器预览"}</small></span></button>
      </aside>
      <main className="workspace">
        <div className="workspace-head"><div className="breadcrumb"><Icon name="folder" size={15} /><span>{cluster.name}</span><button className="icon-button" aria-label="重命名 note 夹" onClick={() => { setFolderName(cluster.name); setFolderDialog("rename"); }}><Icon name="edit" size={13} /></button></div>
          <label className="search"><Icon name="search" size={15} /><input aria-label="搜索当前 note 夹" placeholder="搜索此夹…" value={search} onChange={e => setSearch(e.target.value)} /></label>
        </div>
        <div className="tabs-row"><nav className="note-tabs" aria-label="夹内便签切换">{visibleNotes.map(n => <button key={n.id} className={n.id === noteId ? "selected" : ""} aria-current={n.id === noteId ? "page" : undefined} title={n.title} onClick={() => switchNote(n.id)}>{n.title || "未命名便签"}</button>)}{search && !visibleNotes.length && <span className="no-results">没有匹配的便签</span>}</nav>
          <button className="icon-button new-note" title="新建便签 · Ctrl+Shift+N" aria-label="新建便签" onClick={addNote}><Icon name="plus" /></button>
        </div>
        {saveError && <div className="save-error" role="alert"><span>{saveError}</span><button onClick={() => workspaceRef.current && save(workspaceRef.current)}>重试保存</button>{desktop && <button onClick={() => void reloadFiles(true)}>保留副本并重新载入</button>}</div>}
        {note ? <section className="note-sheet">
          <header className="note-toolbar"><input ref={title} className="note-title" aria-label="便签标题" placeholder="未命名便签" value={note.title} onChange={e => updateNote({ title: e.target.value })} />
            <div className="note-actions">
              <button className="icon-button" aria-label="撤销" title="撤销 · Ctrl+Z" disabled={source || !editor.current?.can().undo()} onClick={() => editor.current?.chain().focus().undo().run()}><Icon name="undo" size={16} /></button>
              <button className="icon-button" aria-label="重做" title="重做 · Ctrl+Shift+Z" disabled={source || !editor.current?.can().redo()} onClick={() => editor.current?.chain().focus().redo().run()}><Icon name="redo" size={16} /></button>
              <span className="divider" />
              <button className={"icon-button" + (source ? "active" : "")} aria-label={source ? "返回即时编辑" : "查看 Markdown"} title={source ? "返回即时编辑" : "Markdown 源码"} onClick={() => setSource(v => !v)}><Icon name={source ? "edit" : "code"} size={16} /></button>
              <button className="icon-button" aria-label="复制便签内容" title="复制 Markdown 内容" onClick={() => void copy()}><Icon name="copy" size={16} /></button>
              {desktop && <button className="icon-button" aria-label="打开 Markdown 文件" title="用默认应用打开 Markdown 文件" onClick={() => void openFile()}><Icon name="external" size={15} /></button>}
              <button className="icon-button danger" aria-label="删除便签" title="删除便签" onClick={() => setDeleting(true)}><Icon name="trash" size={16} /></button>
            </div>
          </header>
          <div className="document-scroll" key={workspaceEpoch + ":" + note.id}>
            {source ? <textarea className="markdown-source" aria-label="Markdown 源码" value={note.content} spellCheck={false} onChange={e => updateContent(e.target.value)} />
              : <NoteEditor key={note.id} content={note.content} onChange={updateContent} onReady={attachEditor} />}
          </div>
          <footer className="note-footer"><span>{source ? "Markdown" : "即时编辑"}<i />{note.content.length} 字符</span><span>编辑于 {new Date(note.updatedAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}</span></footer>
        </section> : <section className="empty-note"><Icon name="edit" size={32} /><h2>给这个夹写第一张便签</h2><button className="button primary" onClick={addNote}>新建便签</button></section>}
      </main>
    </div>
    {storageOpen && <Modal title="数据目录" onClose={() => setStorageOpen(false)}><DirectoryForm current={dataDir} suggested={suggested} migrating onApply={applyDirectory} onCancel={() => setStorageOpen(false)} onReload={() => reloadFiles()} canReload={saveState === "saved"} /></Modal>}
    {folderDialog && <Modal title={folderDialog === "new" ? "新建 note 夹" : "重命名 note 夹"} onClose={() => setFolderDialog(null)}><form onSubmit={e => { e.preventDefault(); submitFolder(); }}><label className="field"><span>名称</span><input aria-label="Note 夹名称" value={folderName} onChange={e => setFolderName(e.target.value)} maxLength={80} /></label><div className="modal-actions"><button type="button" className="button" onClick={() => setFolderDialog(null)}>取消</button><button className="button primary" disabled={!folderName.trim()}>保存</button></div></form></Modal>}
    {deleting && <Modal title="删除便签" onClose={() => setDeleting(false)}><p className="hint">将删除「{note?.title || "未命名便签"}」及其内容。</p><div className="modal-actions"><button className="button" onClick={() => setDeleting(false)}>取消</button><button className="button danger-solid" onClick={deleteNote}>确认删除</button></div></Modal>}
    {toast && <div className="toast" role="status">{toast}</div>}
    {reloading && <div className="overlay loading-overlay" role="status" aria-live="polite"><div className="reload-card">正在载入便签文件…</div></div>}
  </div>;
}
