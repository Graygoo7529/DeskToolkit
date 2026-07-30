import { invoke } from "@tauri-apps/api/core";
import { KIND_LABEL, type AppState, type ItemKind, type LaunchItem, type Project } from "./types";

export const api = {
  // 运行目录
  getState: () => invoke<AppState>("get_state"),
  suggestRuntimeDir: () => invoke<string>("suggest_runtime_dir"),
  setRuntimeDir: (path: string) => invoke<void>("set_runtime_dir", { path }),

  // 项目
  listProjects: () => invoke<Project[]>("list_projects"),
  createProject: (name: string, description: string, icon: string, color: string) =>
    invoke<Project>("create_project", { name, description, icon, color }),
  updateProject: (project: Project) => invoke<void>("update_project", { project }),
  deleteProject: (id: string) => invoke<void>("delete_project", { id }),

  // 启动
  launchItem: (item: LaunchItem) => invoke<void>("launch_item", { item }),
  pathKind: (path: string) => invoke<"folder" | "file" | "missing">("path_kind", { path }),

  // 项目文档
  listDocs: (projectId: string) => invoke<string[]>("list_docs", { projectId }),
  readDoc: (projectId: string, name: string) => invoke<string>("read_doc", { projectId, name }),
  writeDoc: (projectId: string, name: string, content: string) =>
    invoke<void>("write_doc", { projectId, name, content }),
  createDoc: (projectId: string, name: string) => invoke<string>("create_doc", { projectId, name }),
  deleteDoc: (projectId: string, name: string) => invoke<void>("delete_doc", { projectId, name }),
  renameDoc: (projectId: string, oldName: string, newName: string) =>
    invoke<string>("rename_doc", { projectId, oldName, newName }),
};

export const uid = () => `i${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** 从路径取最后一段作为显示名 */
export function basename(p: string): string {
  return p.replace(/\\/g, "/").split("/").filter(Boolean).pop() || p;
}

const APP_EXT = /\.(exe|bat|cmd|com|msi|lnk)$/i;

/** 拖入文件时推断条目类型 */
export function inferKind(path: string, fsKind: "folder" | "file"): "folder" | "app" | "file" {
  if (fsKind === "folder") return "folder";
  return APP_EXT.test(path) ? "app" : "file";
}

/** 拖入条目的默认显示名：应用程序去掉扩展名（如「微信.lnk」→「微信」） */
export function dropItemName(path: string, kind: ItemKind): string {
  const base = basename(path);
  return kind === "app" ? base.replace(/\.(exe|lnk|bat|cmd|com|msi)$/i, "") : base;
}

/** 类型标签文案（命令附带终端类型） */
export function kindLabel(item: LaunchItem): string {
  if (item.kind === "command") {
    return `终端命令 · ${item.shell === "powershell" ? "PowerShell" : "CMD"}`;
  }
  return KIND_LABEL[item.kind];
}
