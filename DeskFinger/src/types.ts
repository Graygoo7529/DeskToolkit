// 与 src-tauri/src/lib.rs 中的数据模型保持一致

export type ItemKind = "folder" | "app" | "file" | "command" | "web";

export type ShellKind = "cmd" | "powershell";

export interface LaunchItem {
  id: string;
  kind: ItemKind;
  name: string;
  /** 目标路径；kind 为 command 时是终端命令内容（支持多行，逐行顺序执行） */
  path: string;
  args: string;
  /** 终端类型，仅 kind 为 command 时有意义 */
  shell: ShellKind;
  /** 执行完是否保持终端窗口打开，仅 kind 为 command 时有意义 */
  keepOpen: boolean;
  enabled: boolean;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  createdAt: number;
  quickLinks: LaunchItem[];
  oneClick: LaunchItem[];
}

export interface AppState {
  runtimeDir: string | null;
}

export const KIND_LABEL: Record<ItemKind, string> = {
  folder: "文件夹",
  app: "应用程序",
  file: "文档文件",
  command: "终端命令",
  web: "网页",
};

export const KIND_ICON: Record<ItemKind, string> = {
  folder: "📁",
  app: "🚀",
  file: "📄",
  command: "💻",
  web: "🌐",
};

export const PROJECT_ICONS = ["📁", "🚀", "🛠️", "🎮", "📚", "🎨", "🧪", "💼", "🌐", "🎵", "📷", "🤖"];

export const PROJECT_COLORS = ["#6e8bff", "#9b6dff", "#ff6d9b", "#ff9f6e", "#4fd1a5", "#4fc3f7", "#ffd166", "#94a3b8"];
