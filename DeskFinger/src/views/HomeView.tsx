import { useCallback, useEffect, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { api, sleep } from "../api";
import type { Project } from "../types";
import Modal from "../components/Modal";
import ProjectMetaModal from "../components/ProjectMetaModal";

interface HomeViewProps {
  runtimeDir: string;
  onOpen: (id: string) => void;
  onRuntimeChanged: () => void;
}

/** 主界面：项目入口卡片墙 */
export default function HomeView({ runtimeDir, onOpen, onRuntimeChanged }: HomeViewProps) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Project | null>(null);
  const [deleting, setDeleting] = useState<Project | null>(null);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [toast, setToast] = useState("");
  const toastTimer = useRef<number | undefined>(undefined);

  const notify = useCallback((msg: string) => {
    setToast(msg);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(""), 2800);
  }, []);

  /** 在项目卡片上直接执行该项目的一键启动 */
  const runOneClick = async (p: Project) => {
    if (runningId) return;
    const items = p.oneClick.filter((i) => i.enabled);
    if (items.length === 0) return notify(`「${p.name}」还没有已启用的一键启动项`);
    setRunningId(p.id);
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
    setRunningId(null);
    notify(`「${p.name}」一键启动完成：${ok}/${items.length} 项已执行`);
  };

  const load = useCallback(() => {
    setLoading(true);
    api
      .listProjects()
      .then((ps) => {
        setProjects(ps);
        setError("");
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load, runtimeDir]);

  const changeRuntimeDir = async () => {
    try {
      const picked = await open({ directory: true, title: "选择新的运行目录" });
      if (typeof picked === "string") {
        await api.setRuntimeDir(picked);
        onRuntimeChanged();
      }
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <div className="page">
      <header className="app-header">
        <div className="brand">
          <span className="brand-logo">👆</span>
          <span className="brand-name">DeskFinger</span>
        </div>
        <div className="runtime-dir" title={runtimeDir}>
          <span className="dim">运行目录</span>
          <code>{runtimeDir}</code>
          <button className="btn btn-sm" onClick={changeRuntimeDir}>
            更换…
          </button>
        </div>
      </header>

      <main className="page-body">
        <div className="section-head">
          <h2>我的项目</h2>
          <button className="btn btn-primary" onClick={() => setCreating(true)}>
            ＋ 新建项目
          </button>
        </div>

        {error && <div className="form-error">{error}</div>}
        {loading ? (
          <div className="dim pad">加载中…</div>
        ) : projects.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">🗂️</div>
            <p>还没有项目。点击「新建项目」创建第一个项目入口吧。</p>
          </div>
        ) : (
          <div className="project-grid">
            {projects.map((p) => (
              <div
                key={p.id}
                className="project-card"
                style={{ ["--accent" as string]: p.color }}
                onClick={() => onOpen(p.id)}
              >
                <div className="project-icon">{p.icon}</div>
                <div className="project-name">{p.name}</div>
                <div className="project-desc dim">{p.description || "（暂无描述）"}</div>
                <div className="project-meta dim">
                  <span>⚡ {p.quickLinks.length} 个快速启动</span>
                  <span>▶ {p.oneClick.filter((i) => i.enabled).length} 项一键启动</span>
                </div>
                <div className="project-actions" onClick={(e) => e.stopPropagation()}>
                  <button
                    className="btn btn-sm btn-primary"
                    disabled={runningId === p.id || p.oneClick.every((i) => !i.enabled)}
                    title={p.oneClick.some((i) => i.enabled) ? "按顺序执行已启用的启动项" : "还没有已启用的一键启动项"}
                    onClick={() => runOneClick(p)}
                  >
                    {runningId === p.id ? "执行中…" : "▶ 一键启动"}
                  </button>
                  <div className="spacer" />
                  <button className="btn btn-sm" onClick={() => setEditing(p)}>
                    编辑
                  </button>
                  <button className="btn btn-sm btn-danger-ghost" onClick={() => setDeleting(p)}>
                    删除
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {creating && (
        <ProjectMetaModal
          title="新建项目"
          onClose={() => setCreating(false)}
          onSave={async (meta) => {
            const p = await api.createProject(meta.name, meta.description, meta.icon, meta.color);
            setCreating(false);
            onOpen(p.id);
          }}
        />
      )}

      {editing && (
        <ProjectMetaModal
          title="编辑项目信息"
          initial={editing}
          onClose={() => setEditing(null)}
          onSave={async (meta) => {
            await api.updateProject({ ...editing, ...meta });
            setEditing(null);
            load();
          }}
        />
      )}

      {deleting && (
        <Modal
          title={`删除项目「${deleting.name}」`}
          onClose={() => setDeleting(null)}
          footer={
            <>
              <button className="btn" onClick={() => setDeleting(null)}>
                取消
              </button>
              <button
                className="btn btn-danger"
                onClick={async () => {
                  try {
                    await api.deleteProject(deleting.id);
                    setDeleting(null);
                    load();
                  } catch (e) {
                    setError(String(e));
                    setDeleting(null);
                  }
                }}
              >
                确认删除
              </button>
            </>
          }
        >
          <p>
            将删除运行目录中该项目的全部文件，包括 <code>project.json</code> 和所有项目文档，
            <b>此操作不可恢复</b>。你的外部项目资源（文件夹、程序、文档）不受影响。
          </p>
        </Modal>
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
