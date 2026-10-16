import { useCallback, useEffect, useRef, useState } from "react";
import { api, sleep } from "../api";
import type { Project } from "../types";
import QuickLaunchPanel from "../components/QuickLaunchPanel";
import DocsPanel from "../components/DocsPanel";
import ProjectMetaModal from "../components/ProjectMetaModal";
import Icon, { ProjectIcon } from "../components/Icon";

type Tab = "quick" | "docs";

const TABS: { key: Tab; label: string; icon: "bolt" | "book" }[] = [
  { key: "quick", label: "快速启动", icon: "bolt" },
  { key: "docs", label: "项目文档", icon: "book" },
];

interface ProjectViewProps {
  projectId: string;
  onBack: () => void;
  onSwitchProject: (id: string) => void;
}

export default function ProjectView({ projectId, onBack, onSwitchProject }: ProjectViewProps) {
  const [project, setProject] = useState<Project | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(true);
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
    let active = true;
    setProject(null);
    setMissing(false);
    setProjectsLoading(true);
    api
      .listProjects()
      .then((ps) => {
        if (!active) return;
        setProjects(ps);
        const p = ps.find((x) => x.id === projectId);
        if (p) setProject(p);
        else setMissing(true);
        setProjectsLoading(false);
      })
      .catch((e) => {
        if (!active) return;
        setProjectsLoading(false);
        notify(`加载项目失败：${e}`);
      });
    return () => {
      active = false;
    };
  }, [projectId, notify]);

  /** 本地立即生效 + 落盘 */
  const save = useCallback(
    (next: Project) => {
      setProject(next);
      setProjects((current) => current.map((item) => (item.id === next.id ? next : item)));
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
            <Icon name="arrow-left" size={15} />
            返回主页
          </button>
        </div>
      </div>
    );
  }
  if (!project) return <div className="center-screen dim">加载中…</div>;

  return (
    <div className="page project-page" style={{ ["--accent" as string]: project.color }}>
      <div className="project-shell">
        <aside className="project-rail" aria-label="项目切换">
          <button className="project-home-tab" onClick={onBack} title="返回我的项目">
            <span className="project-home-icon"><Icon name="home" size={16} /></span>
            <span>我的项目</span>
          </button>
          <div className="project-rail-heading">
            <span>项目</span>
            <span className="project-rail-count">{projects.length}</span>
          </div>
          <nav className="project-switch-list">
            {projectsLoading && <div className="project-rail-loading">载入中…</div>}
            {projects.map((item) => (
              <button
                key={item.id}
                className={`project-switch-tab ${item.id === project.id ? "active" : ""}`}
                style={{ ["--tab-accent" as string]: item.color }}
                onClick={() => item.id !== project.id && onSwitchProject(item.id)}
                title={`切换到 ${item.name}`}
                aria-current={item.id === project.id ? "page" : undefined}
              >
                <span className="project-switch-icon"><ProjectIcon value={item.icon} size={17} /></span>
                <span className="project-switch-name">{item.name}</span>
              </button>
            ))}
          </nav>
          <div className="project-rail-footer">
            <span className="project-rail-status" />
            <span>工作空间</span>
          </div>
        </aside>

        <section className="project-workspace">
          <header className="project-header">
            <button className="btn btn-icon project-back" onClick={onBack} title="返回我的项目">
              <Icon name="arrow-left" size={17} />
            </button>
            <div className="project-title">
              <span className="project-title-icon"><ProjectIcon value={project.icon} size={25} /></span>
              <div>
                <div className="project-title-kicker">PROJECT SPACE</div>
                <div className="project-title-name">
                  {project.name}
                  <button className="btn btn-icon btn-sm" title="编辑项目信息" onClick={() => setEditing(true)}>
                    <Icon name="edit" size={14} />
                  </button>
                </div>
                {project.description && <div className="dim project-title-desc">{project.description}</div>}
              </div>
            </div>
            <div className="spacer" />
            <button className="btn btn-primary btn-lg project-run" onClick={runOneClick} disabled={running}>
              {running ? "正在执行…" : <><Icon name="play" size={14} /> 一键启动</>}
            </button>
          </header>

          <nav className="tabs">
            {TABS.map((t) => (
              <button key={t.key} className={`tab ${tab === t.key ? "active" : ""}`} onClick={() => setTab(t.key)}>
              <Icon name={t.icon} size={14} />
              <span>{t.label}</span>
              </button>
            ))}
          </nav>

          <main className="page-body panel-body">
            {tab === "quick" && <QuickLaunchPanel project={project} onChange={save} notify={notify} />}
            {tab === "docs" && <DocsPanel projectId={project.id} notify={notify} />}
          </main>
        </section>
      </div>

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
