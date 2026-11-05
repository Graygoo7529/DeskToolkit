import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";

type Note = { id: string; title: string; content: string; color: string; updatedAt: number };
type Cluster = { id: string; name: string; icon: string; color: string; notes: Note[] };
type Workspace = { clusters: Cluster[] };

const STORAGE_KEY = "desktodo-workspace-v1";
const colors = ["#8c9eff", "#8bd8c2", "#e9ad79", "#d7a1ef", "#ef8f9e", "#7fc6ea"];

const uid = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

const starter: Workspace = {
  clusters: [
    {
      id: "inbox",
      name: "收件箱",
      icon: "✦",
      color: "#8c9eff",
      notes: [
        {
          id: "welcome",
          title: "欢迎来到 DeskTodo",
          color: "#8c9eff",
          updatedAt: Date.now(),
          content: `# 让想法有个落脚点

DeskTodo 是一张安静、灵活的桌面便签。把零散想法放进 note，再用 **Markdown** 把它们整理成可以行动的计划。

## 现在就试试

- [ ] 按下 Ctrl / ⌘ + K 打开快捷菜单
- [ ] 勾选这条待办，或移除它
- [x] 已完成的事情可以一键清理

> 小提示：在新行输入斜杠，也可以呼出插入菜单。

$$
\text{one thought} + \text{one action} = \text{momentum}
$$`,
        },
        {
          id: "today",
          title: "今日清单",
          color: "#e9ad79",
          updatedAt: Date.now() - 3600000,
          content: `# 今天只做重要的事

- [ ] 整理本周会议记录
- [ ] 给设计稿补充交互说明
- [x] 回复项目同步邮件

## 记录

把下一步写得足够小，开始就会变得容易。`,
        },
      ],
    },
    {
      id: "work",
      name: "工作流",
      icon: "◈",
      color: "#8bd8c2",
      notes: [
        {
          id: "sprint",
          title: "Sprint planning",
          color: "#8bd8c2",
          updatedAt: Date.now() - 7200000,
          content: `# Sprint planning

## 本周目标

- [ ] 确认交付边界
- [ ] 拆分接口任务
- [ ] 预留验收时间

流程：focus → build → review → ship`,
        },
      ],
    },
    {
      id: "ideas",
      name: "灵感库",
      icon: "✺",
      color: "#d7a1ef",
      notes: [
        {
          id: "quiet",
          title: "安静的产品想法",
          color: "#d7a1ef",
          updatedAt: Date.now() - 86400000,
          content: `# 安静的产品想法

把工具做成一张不会打断人的桌面纸张：

1. 先写下来
2. 再慢慢整理
3. 在合适的时间行动

标签：calm · local-first`,
        },
      ],
    },
  ],
};

function loadWorkspace(): Workspace {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null") as Workspace | null;
    if (value?.clusters?.length) return value;
  } catch {
    // A broken local cache should never prevent the note app from opening.
  }
  return starter;
}

function noteStats(content: string) {
  const todos = content.match(/^\s*[-*]\s+\[[ xX]\]\s+.+$/gm) || [];
  const done = todos.filter((line) => /\[[xX]\]/.test(line)).length;
  return { total: todos.length, done };
}

function formatTime(value: number) {
  const date = new Date(value);
  const today = new Date();
  if (date.toDateString() === today.toDateString()) {
    return date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  }
  return date.toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" });
}

function Icon({ children }: { children: string }) {
  return <span className="icon" aria-hidden="true">{children}</span>;
}

function InlineMarkdown({ text }: { text: string }) {
  const pieces = text.split(/(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|~~[^~]+~~|\[[^\]]+\]\([^)]+\))/g).filter(Boolean);
  return (
    <>
      {pieces.map((piece, index) => {
        if (piece.startsWith("`") && piece.endsWith("`")) return <code key={index}>{piece.slice(1, -1)}</code>;
        if (piece.startsWith("**") && piece.endsWith("**")) return <strong key={index}>{piece.slice(2, -2)}</strong>;
        if (piece.startsWith("*") && piece.endsWith("*")) return <em key={index}>{piece.slice(1, -1)}</em>;
        if (piece.startsWith("~~") && piece.endsWith("~~")) return <del key={index}>{piece.slice(2, -2)}</del>;
        const link = piece.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
        if (link) return <a key={index} href={link[2]} target="_blank" rel="noreferrer">{link[1]}</a>;
        return <Fragment key={index}>{piece}</Fragment>;
      })}
    </>
  );
}

type PreviewProps = {
  content: string;
  onToggleTodo: (lineIndex: number) => void;
  onRemoveTodo: (lineIndex: number) => void;
};

function MarkdownPreview({ content, onToggleTodo, onRemoveTodo }: PreviewProps) {
  const lines = content.split("\n");
  const blocks: React.ReactNode[] = [];
  let inCode = false;
  let codeLines: string[] = [];
  let codeStart = 0;
  let inFormula = false;
  let formulaLines: string[] = [];

  lines.forEach((line, index) => {
    if (line.trim().startsWith("```") && !inFormula) {
      if (!inCode) {
        inCode = true;
        codeStart = index;
        codeLines = [];
      } else {
        blocks.push(<pre className="code-block" key={`code-${codeStart}`}><code>{codeLines.join("\n")}</code></pre>);
        inCode = false;
      }
      return;
    }
    if (inCode) {
      codeLines.push(line);
      return;
    }
    if (line.trim() === "$$") {
      if (!inFormula) {
        inFormula = true;
        formulaLines = [];
      } else {
        blocks.push(<div className="formula-block" key={`formula-${index}`}><span className="formula-label">ƒx</span><code>{formulaLines.join(" ")}</code></div>);
        inFormula = false;
      }
      return;
    }
    if (inFormula) {
      formulaLines.push(line.trim());
      return;
    }
    if (!line.trim()) {
      blocks.push(<div className="md-space" key={`space-${index}`} />);
      return;
    }
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      const Tag = `h${heading[1].length}` as "h1" | "h2" | "h3";
      blocks.push(<Tag key={index}><InlineMarkdown text={heading[2]} /></Tag>);
      return;
    }
    const todo = line.match(/^\s*[-*]\s+\[([ xX])\]\s+(.+)$/);
    if (todo) {
      const checked = todo[1].toLowerCase() === "x";
      blocks.push(
        <div className={`todo-row ${checked ? "is-done" : ""}`} key={index}>
          <button className={`todo-check ${checked ? "checked" : ""}`} onClick={() => onToggleTodo(index)} aria-label={checked ? "标记未完成" : "标记完成"}>{checked ? "✓" : ""}</button>
          <span><InlineMarkdown text={todo[2]} /></span>
          <button className="todo-remove" onClick={() => onRemoveTodo(index)} aria-label="移除待办">×</button>
        </div>,
      );
      return;
    }
    const ordered = line.match(/^\s*(\d+)\.\s+(.+)$/);
    if (ordered) {
      blocks.push(<div className="list-row ordered" key={index}><span>{ordered[1]}.</span><InlineMarkdown text={ordered[2]} /></div>);
      return;
    }
    const bullet = line.match(/^\s*[-*+]\s+(.+)$/);
    if (bullet) {
      blocks.push(<div className="list-row" key={index}><span>•</span><InlineMarkdown text={bullet[1]} /></div>);
      return;
    }
    if (line.startsWith(">")) {
      blocks.push(<blockquote key={index}><InlineMarkdown text={line.replace(/^>\s?/, "")} /></blockquote>);
      return;
    }
    blocks.push(<p key={index}><InlineMarkdown text={line} /></p>);
  });

  if (inCode && codeLines.length) blocks.push(<pre className="code-block" key={`code-${codeStart}`}><code>{codeLines.join("\n")}</code></pre>);
  if (inFormula && formulaLines.length) blocks.push(<div className="formula-block" key="open-formula"><span className="formula-label">ƒx</span><code>{formulaLines.join(" ")}</code></div>);
  return <div className="markdown-preview">{blocks}</div>;
}

function App() {
  const [workspace, setWorkspace] = useState<Workspace>(loadWorkspace);
  const [activeClusterId, setActiveClusterId] = useState("inbox");
  const [activeNoteId, setActiveNoteId] = useState("welcome");
  const [mode, setMode] = useState<"split" | "write" | "preview">("split");
  const [search, setSearch] = useState("");
  const [quickMenu, setQuickMenu] = useState(false);
  const [toast, setToast] = useState("");
  const [saved, setSaved] = useState(true);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(workspace));
    setSaved(true);
  }, [workspace]);

  const activeCluster = useMemo(() => workspace.clusters.find((cluster) => cluster.id === activeClusterId) || workspace.clusters[0], [workspace, activeClusterId]);
  const activeNote = useMemo(() => activeCluster?.notes.find((note) => note.id === activeNoteId) || activeCluster?.notes[0], [activeCluster, activeNoteId]);
  const visibleNotes = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return activeCluster?.notes || [];
    return (activeCluster?.notes || []).filter((note) => `${note.title} ${note.content}`.toLowerCase().includes(needle));
  }, [activeCluster, search]);
  const stats = activeNote ? noteStats(activeNote.content) : { total: 0, done: 0 };

  useEffect(() => {
    if (!activeCluster) return;
    if (!activeCluster.notes.some((note) => note.id === activeNoteId)) setActiveNoteId(activeCluster.notes[0]?.id || "");
  }, [activeCluster, activeNoteId]);

  const updateNote = useCallback((changes: Partial<Note>) => {
    setSaved(false);
    setWorkspace((previous) => ({
      clusters: previous.clusters.map((cluster) => cluster.id !== activeClusterId ? cluster : {
        ...cluster,
        notes: cluster.notes.map((note) => note.id !== activeNoteId ? note : { ...note, ...changes, updatedAt: Date.now() }),
      }),
    }));
  }, [activeClusterId, activeNoteId]);

  const updateContent = useCallback((content: string) => updateNote({ content }), [updateNote]);

  const createNote = useCallback(() => {
    const note: Note = { id: uid("note"), title: "未命名便签", content: "# 未命名便签\n\n开始记录你的想法……\n", color: colors[(activeCluster?.notes.length || 0) % colors.length], updatedAt: Date.now() };
    setWorkspace((previous) => ({ clusters: previous.clusters.map((cluster) => cluster.id === activeClusterId ? { ...cluster, notes: [note, ...cluster.notes] } : cluster) }));
    setActiveNoteId(note.id);
    setSearch("");
    window.setTimeout(() => titleRef.current?.select(), 30);
  }, [activeCluster, activeClusterId]);

  const deleteNote = useCallback(() => {
    if (!activeNote || !activeCluster || activeCluster.notes.length <= 1) {
      setToast("每个 note 夹至少保留一张便签");
      return;
    }
    if (!window.confirm(`删除「${activeNote.title}」？`)) return;
    const remaining = activeCluster.notes.filter((note) => note.id !== activeNote.id);
    setWorkspace((previous) => ({ clusters: previous.clusters.map((cluster) => cluster.id === activeClusterId ? { ...cluster, notes: remaining } : cluster) }));
    setActiveNoteId(remaining[0].id);
  }, [activeCluster, activeClusterId, activeNote]);

  const duplicateNote = useCallback(() => {
    if (!activeNote) return;
    const note: Note = { ...activeNote, id: uid("note"), title: `${activeNote.title} · 副本`, updatedAt: Date.now() };
    setWorkspace((previous) => ({ clusters: previous.clusters.map((cluster) => cluster.id === activeClusterId ? { ...cluster, notes: [note, ...cluster.notes] } : cluster) }));
    setActiveNoteId(note.id);
    setToast("已复制 note");
  }, [activeClusterId, activeNote]);

  const addCluster = () => {
    const name = window.prompt("新建 note 夹名称", "新 note 夹")?.trim();
    if (!name) return;
    const cluster: Cluster = { id: uid("cluster"), name, icon: "✧", color: colors[workspace.clusters.length % colors.length], notes: [{ id: uid("note"), title: "第一张便签", content: "# 第一张便签\n\n", color: colors[workspace.clusters.length % colors.length], updatedAt: Date.now() }] };
    setWorkspace((previous) => ({ clusters: [...previous.clusters, cluster] }));
    setActiveClusterId(cluster.id);
    setActiveNoteId(cluster.notes[0].id);
  };

  const removeTodo = (lineIndex: number) => updateContent(activeNote?.content.split("\n").filter((_, index) => index !== lineIndex).join("\n") || "");
  const toggleTodo = (lineIndex: number) => {
    if (!activeNote) return;
    const lines = activeNote.content.split("\n");
    lines[lineIndex] = lines[lineIndex].replace(/\[([ xX])\]/, (_, mark: string) => mark.toLowerCase() === "x" ? "[ ]" : "[x]");
    updateContent(lines.join("\n"));
  };
  const clearCompleted = () => {
    if (!activeNote) return;
    const next = activeNote.content.split("\n").filter((line) => !/^\s*[-*]\s+\[[xX]\]\s+/.test(line)).join("\n");
    updateContent(next);
    setToast("已清除完成的待办");
  };
  const copyNote = async () => {
    if (!activeNote) return;
    await navigator.clipboard?.writeText(activeNote.content);
    setToast("note 全文已复制");
  };

  const insertBlock = (kind: "todo" | "formula") => {
    if (!activeNote) return;
    const block = kind === "todo" ? "- [ ] 新待办" : "$$\n\\text{write your formula here}\n$$";
    const content = /\/[^\n]*$/.test(activeNote.content) ? activeNote.content.replace(/\/[^\n]*$/, block) : `${activeNote.content.replace(/\s*$/, "")}\n\n${block}`;
    updateContent(content.endsWith("\n") ? content : `${content}\n`);
    setQuickMenu(false);
    setMode("split");
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const command = event.ctrlKey || event.metaKey;
      if (command && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setQuickMenu((open) => !open);
      }
      if (command && event.shiftKey && event.key.toLowerCase() === "n") {
        event.preventDefault();
        createNote();
      }
      if (command && event.key.toLowerCase() === "s") {
        event.preventDefault();
        setSaved(true);
      }
      if (event.key === "Escape") setQuickMenu(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [createNote]);

  useEffect(() => {
    const timer = window.setTimeout(() => setToast(""), 2200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const isSlashCommand = activeNote?.content.split("\n").slice(-1)[0]?.match(/^\s*\/[^\s]*$/);
  if (!activeCluster || !activeNote) return null;

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-mark"><span className="brand-orbit">✦</span><div><strong>DeskTodo</strong><span>桌面便签 · local first</span></div></div>
        <div className="topbar-search"><Icon>⌕</Icon><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索所有便签…" /><kbd>⌘ K</kbd></div>
        <div className="topbar-actions"><span className="sync-state"><i className={saved ? "synced" : "saving"} />{saved ? "已保存" : "正在保存"}</span><button className="round-button" onClick={() => setQuickMenu(true)} aria-label="打开快捷菜单">⌘</button><div className="avatar">D</div></div>
      </header>
      <div className="app-body">
        <aside className="cluster-sidebar">
          <div className="sidebar-heading"><span>NOTE 夹</span><button onClick={addCluster} aria-label="新建 note 夹">＋</button></div>
          <nav className="cluster-list">
            {workspace.clusters.map((cluster) => {
              const clusterStats = cluster.notes.reduce((sum, note) => sum + noteStats(note.content).total, 0);
              return <button key={cluster.id} className={`cluster-item ${cluster.id === activeCluster.id ? "active" : ""}`} style={{ "--cluster-color": cluster.color } as React.CSSProperties} onClick={() => { setActiveClusterId(cluster.id); setActiveNoteId(cluster.notes[0]?.id || ""); }}><span className="cluster-icon">{cluster.icon}</span><span className="cluster-copy"><b>{cluster.name}</b><small>{cluster.notes.length} notes · {clusterStats} 待办</small></span>{cluster.id === activeCluster.id && <span className="active-pip" />}</button>;
            })}
          </nav>
          <div className="sidebar-bottom"><div className="shortcut-card"><span className="sparkle">✦</span><div><b>保持流动</b><small>输入 / 插入块</small></div><kbd>/</kbd></div><div className="sidebar-footer"><span>⌘ 2026 DeskTodo</span><button onClick={() => setToast("所有数据保存在当前设备")}>隐私</button></div></div>
        </aside>
        <main className="workspace">
          <section className="note-strip-head"><div><span className="eyebrow">{activeCluster.icon} {activeCluster.name}</span><h1>你的便签</h1></div><div className="note-strip-actions"><span className="note-count">{visibleNotes.length} / {activeCluster.notes.length}</span><button className="primary-button" onClick={createNote}><Icon>＋</Icon> 新 note <kbd>⌘ ⇧ N</kbd></button></div></section>
          <section className="note-rail" aria-label="便签列表">
            {visibleNotes.map((note) => { const itemStats = noteStats(note.content); return <button key={note.id} className={`note-card ${note.id === activeNote.id ? "selected" : ""}`} style={{ "--note-color": note.color } as React.CSSProperties} onClick={() => setActiveNoteId(note.id)}><span className="note-card-line" /><span className="note-card-title">{note.title}</span><span className="note-card-preview">{note.content.replace(/[#>*`\[\]]/g, "").replace(/\n/g, " ").slice(0, 76)}</span><span className="note-card-meta"><span>{itemStats.total ? `${itemStats.done}/${itemStats.total} done` : "无待办"}</span><time>{formatTime(note.updatedAt)}</time></span></button>; })}
            <button className="new-note-card" onClick={createNote}><span>＋</span><small>新建便签</small></button>
          </section>
          <section className="editor-shell">
            <div className="editor-toolbar"><div className="editor-title"><span className="note-dot" style={{ background: activeNote.color }} /><input ref={titleRef} value={activeNote.title} onChange={(event) => updateNote({ title: event.target.value })} aria-label="便签标题" /></div><div className="toolbar-actions"><button className={`toolbar-button ${mode === "write" ? "active" : ""}`} onClick={() => setMode("write")}>写作</button><button className={`toolbar-button ${mode === "split" ? "active" : ""}`} onClick={() => setMode("split")}>分屏</button><button className={`toolbar-button ${mode === "preview" ? "active" : ""}`} onClick={() => setMode("preview")}>预览</button><span className="toolbar-divider" /><button className="icon-button" onClick={copyNote} aria-label="复制全文">⧉</button><button className="icon-button" onClick={duplicateNote} aria-label="复制 note">⧉+</button><button className="icon-button danger" onClick={deleteNote} aria-label="删除 note">⌫</button></div></div>
            <div className={`editor-content mode-${mode}`}>
              {mode !== "preview" && <div className="write-pane"><div className="pane-label"><span>MARKDOWN</span><span>自动保存</span></div><textarea value={activeNote.content} onChange={(event) => { updateContent(event.target.value); setQuickMenu(isSlashCommand !== undefined || event.target.value.split("\n").slice(-1)[0]?.startsWith("/") === true); }} onFocus={() => setQuickMenu(Boolean(isSlashCommand))} placeholder="从一个想法开始…" spellCheck={false} /></div>}
              {mode === "split" && <div className="pane-divider" />}
              {mode !== "write" && <div className="preview-pane"><div className="pane-label"><span>LIVE PREVIEW</span><span className="preview-indicator"><i />即时渲染</span></div><MarkdownPreview content={activeNote.content} onToggleTodo={toggleTodo} onRemoveTodo={removeTodo} /></div>}
            </div>
            {quickMenu && <div className="quick-menu"><div className="quick-menu-head"><span>快速插入</span><kbd>ESC</kbd></div><button onClick={() => insertBlock("todo")}><span className="menu-symbol checkbox-symbol">☑</span><span><b>待办块</b><small>插入一行可交互待办</small></span><kbd>/todo</kbd></button><button onClick={() => insertBlock("formula")}><span className="menu-symbol">ƒx</span><span><b>公式块</b><small>为公式、转换插件预留</small></span><kbd>/formula</kbd></button><div className="quick-menu-tip">也可以在编辑器新行输入 <code>/</code></div></div>}
            <footer className="editor-footer"><div className="footer-stats"><span><b>{activeNote.content.length}</b> 字符</span><span><b>{activeNote.content.split("\n").length}</b> 行</span><span className="todo-stat"><i />{stats.done}/{stats.total} 待办完成</span></div><div className="footer-actions"><button onClick={clearCompleted} disabled={!stats.done}>清除已完成</button><span>最后编辑于 {formatTime(activeNote.updatedAt)}</span></div></footer>
          </section>
        </main>
      </div>
      {toast && <div className="toast"><span>✦</span>{toast}</div>}
    </div>
  );
}

export default App;
