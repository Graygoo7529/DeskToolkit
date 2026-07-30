import { useCallback, useEffect, useRef, useState } from "react";
import { api, sleep } from "../api";
import type { Project } from "../types";
import QuickLaunchPanel from "../components/QuickLaunchPanel";
import DocsPanel from "../components/DocsPanel";
import ProjectMetaModal from "../components/ProjectMetaModal";

type Tab = "quick" | "docs";

const TABS: { key: Tab; label: string }[] = [
  { key: "quick", label: "⚡ 快速启动" },
  { key: "docs", label: "📝 项目文档" },
];

export default function ProjectView({ projectId, onBack }: { projectId: string; onBack: () => void }) {
  const [project, setProject] = useState<Project | null>(null);
  const [missing, setMissing] = useState(false);
  const [tab, setTab] = useState<Tab>("quick");
  const [editing, setEditing] = useState(false);
  const [running, setRunning] = useState(false);
  const [toast, setToast] = useState("");
  const toastTimer = useRef<number | undefined>(undefined);

  const notify = useCallback((msg: string) => {
    setToast(msg);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(""), 2800);
  }, []);

  useEffect(() => {
    api
      .listProjects()
      .then((ps) => {
        const p = ps.find((x) => x.id === projectId);
        if (p) setProject(p);
        else setMissing(true);
      })
      .catch((e) => notify(`加载项目失败：${e}`));
  }, [projectId, notify]);

  /** 本地立即生效 + 落盘 */
  const save = useCallback(
    (next: Project) => {
      setProject(next);
      api.updateProject(next).catch((e) => notify(`保存失败：${e}`));
    },
    [notify]
  );

  const runOneClick = async () => {
    if (!project || running) return;
    const items = project.oneClick.filter((i) => i.enabled);
    if (items.length === 0) return notify("没有已启用的一键启动项");
    setRunning(true);
    let ok = 0;
    for (const item of items) {
      try {
        await api.launchItem(item);
        ok++;
      } catch (e) {
        notify(`「${item.name}」启动失败：${e}`);
      }
      await sleep(450);
    }
    setRunning(false);
    notify(`一键启动完成：${ok}/${items.length} 项已执行`);
  };

  if (missing) {
    return (
      <div className="center-screen">
        <div className="error-box">
          项目不存在或已被删除。
          <button className="btn" onClick={onBack}>
            返回主页
          </button>
        </div>
      </div>
    );
  }
  if (!project) return <div className="center-screen dim">加载中…</div>;

  return (
    <div className="page" style={{ ["--accent" as string]: project.color }}>
      <header className="project-header">
        <button className="btn btn-icon" onClick={onBack} title="返回主页">
          ←
        </button>
        <div className="project-title">
          <span className="project-title-icon">{project.icon}</span>
          <div>
            <div className="project-title-name">
              {project.name}
              <button className="btn btn-icon btn-sm" title="编辑项目信息" onClick={() => setEditing(true)}>
                ✎
              </button>
            </div>
            {project.description && <div className="dim project-title-desc">{project.description}</div>}
          </div>
        </div>
        <div className="spacer" />
        <button className="btn btn-primary btn-lg" onClick={runOneClick} disabled={running}>
          {running ? "正在执行…" : "▶ 一键启动"}
        </button>
      </header>

      <nav className="tabs">
        {TABS.map((t) => (
          <button key={t.key} className={`tab ${tab === t.key ? "active" : ""}`} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </nav>

      <main className="page-body panel-body">
        {tab === "quick" && <QuickLaunchPanel project={project} onChange={save} notify={notify} />}
        {tab === "docs" && <DocsPanel projectId={project.id} notify={notify} />}
      </main>

      {editing && (
        <ProjectMetaModal
          title="编辑项目信息"
          initial={project}
          onClose={() => setEditing(false)}
          onSave={async (meta) => {
            save({ ...project, ...meta });
            setEditing(false);
          }}
        />
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
