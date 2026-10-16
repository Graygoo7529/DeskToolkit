import type { ItemKind } from "../types";

/** DeskFinger 的线性图标集。图标使用 currentColor，便于跟随项目主题色。 */
export type IconName =
  | "arrow-left"
  | "arrow-right"
  | "arrow-up"
  | "arrow-down"
  | "plus"
  | "close"
  | "edit"
  | "play"
  | "folder"
  | "rocket"
  | "file"
  | "command"
  | "web"
  | "layers"
  | "bolt"
  | "book"
  | "palette"
  | "flask"
  | "briefcase"
  | "globe"
  | "music"
  | "camera"
  | "robot"
  | "inbox"
  | "settings"
  | "grid"
  | "list"
  | "search"
  | "refresh"
  | "trash"
  | "home"
  | "finger";

const paths: Record<IconName, string[]> = {
  "arrow-left": ["M19 12H5", "m11 18-6-6 6-6"],
  "arrow-right": ["M5 12h14", "m13 6 6 6-6 6"],
  "arrow-up": ["M12 19V5", "M6 11l6-6 6 6"],
  "arrow-down": ["M12 5v14", "M6 13l6 6 6-6"],
  plus: ["M12 5v14", "M5 12h14"],
  close: ["m6 6 12 12", "M18 6 6 18"],
  edit: ["m4 16-1 5 5-1L19 9l-4-4L4 16Z", "m13 6 4 4"],
  play: ["m8 5 11 7-11 7V5Z"],
  folder: ["M3 7V5h6l2 2h10v13H3V7Z"],
  rocket: ["M14 4c3-2 6-1 6-1s1 3-1 6l-7 7-5-5 7-7Z", "m8 13-4 1-1 4 4-1 1-4", "M14 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4"],
  file: ["M6 3h8l4 4v14H6V3Z", "M14 3v5h5", "M9 13h6", "M9 17h6"],
  command: ["m8 9-4 3 4 3", "M12 17h7"],
  web: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z", "M3 12h18", "M12 3c2.2 2.4 3.3 5.4 3.3 9s-1.1 6.6-3.3 9c-2.2-2.4-3.3-5.4-3.3-9S9.8 5.4 12 3Z"],
  layers: ["m12 3 9 5-9 5-9-5 9-5Z", "m3 12 9 5 9-5", "m3 16 9 5 9-5"],
  bolt: ["m13 2-9 12h7l-1 8 10-13h-8l1-7Z"],
  book: ["M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16H6.5A2.5 2.5 0 0 0 4 21V5.5Z", "M4 5.5v15", "M8 7h8", "M8 11h6"],
  palette: ["M12 3a9 9 0 1 0 0 18h1.3a1.7 1.7 0 0 0 0-3.4H12a2 2 0 0 1 0-4h3a6 6 0 0 0 6-6 9 9 0 0 0-9-4.6Z", "M7.5 9.5h.01", "M10 6.8h.01", "M15 6.8h.01", "M17.5 9.5h.01"],
  flask: ["M9 3h6", "M10 3v6l-5.5 8.5A2 2 0 0 0 6.2 21h11.6a2 2 0 0 0 1.7-3.5L14 9V3", "M7.5 16h9"],
  briefcase: ["M4 7h16v13H4V7Z", "M9 7V5h6v2", "M4 12h16", "M10 12v2h4v-2"],
  globe: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z", "M3 12h18", "M12 3c2.2 2.4 3.3 5.4 3.3 9s-1.1 6.6-3.3 9c-2.2-2.4-3.3-5.4-3.3-9S9.8 5.4 12 3Z"],
  music: ["M9 18V5l10-2v13", "M9 18a3 3 0 1 1-3-3 3 3 0 0 1 3 3Z", "M19 16a3 3 0 1 1-3-3 3 3 0 0 1 3 3Z"],
  camera: ["M4 7h4l1.5-2h5L16 7h4v12H4V7Z", "M12 16a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"],
  robot: ["M8 8h8a3 3 0 0 1 3 3v7H5v-7a3 3 0 0 1 3-3Z", "M12 5v3", "M9 13h.01", "M15 13h.01", "M9 18v2h6v-2"],
  inbox: ["M4 4h16v13H4V4Z", "M4 13h4l2 3h4l2-3h4", "M8 8h8"],
  settings: ["M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z", "M4.9 6.3 3.5 8.7l2.2 1.3a6.8 6.8 0 0 0 0 4l-2.2 1.3 1.4 2.4 2.4-1.3a7 7 0 0 0 3.5 2l.3 2.7h2.8l.3-2.7a7 7 0 0 0 3.5-2l2.4 1.3 1.4-2.4-2.2-1.3a6.8 6.8 0 0 0 0-4l2.2-1.3-1.4-2.4-2.4 1.3a7 7 0 0 0-3.5-2L13.9 3h-2.8l-.3 2.7a7 7 0 0 0-3.5 2L4.9 6.3Z"],
  grid: ["M5 5h5v5H5V5Z", "M14 5h5v5h-5V5Z", "M5 14h5v5H5v-5Z", "M14 14h5v5h-5v-5Z"],
  list: ["M5 6h.01", "M9 6h10", "M5 12h.01", "M9 12h10", "M5 18h.01", "M9 18h10"],
  search: ["m20 20-4.5-4.5", "M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15Z"],
  refresh: ["M20 7v5h-5", "M4 17v-5h5", "M5.4 7a8 8 0 0 1 13.2-1L20 8", "M4 16l1.4 2A8 8 0 0 0 18.6 17"],
  trash: ["M4 7h16", "M10 11v6", "M14 11v6", "m9 7 1-3h4l1 3", "M6 7l1 14h10l1-14"],
  home: ["m3 11 9-8 9 8", "M5 10v10h14V10", "M9 20v-6h6v6"],
  finger: ["M8 11V6a2 2 0 1 1 4 0v5", "M12 10V4a2 2 0 1 1 4 0v8", "M16 11V7a2 2 0 1 1 4 0v7c0 4-3 7-7 7h-1c-4 0-7-3-7-7V9a2 2 0 1 1 4 0v3", "M8 12 6 10"],
};

export default function Icon({ name, size = 18, strokeWidth = 1.7, className }: { name: IconName; size?: number; strokeWidth?: number; className?: string }) {
  return (
    <svg className={className} aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      {paths[name].map((path, index) => <path key={index} d={path} />)}
    </svg>
  );
}

const projectIconMap: Record<string, IconName> = {
  "📁": "folder", "🚀": "rocket", "🛠️": "settings", "🎮": "layers", "📚": "book", "🎨": "palette",
  "🧪": "flask", "💼": "briefcase", "🌐": "globe", "🎵": "music", "📷": "camera", "🤖": "robot",
};

export function ProjectIcon({ value, size = 22 }: { value: string; size?: number }) {
  const icon = projectIconMap[value];
  return icon ? <Icon name={icon} size={size} /> : <span className="project-fallback-icon">{value}</span>;
}

const kindIconMap: Record<ItemKind, IconName> = { folder: "folder", app: "rocket", file: "file", command: "command", web: "web" };

export function KindIcon({ kind, size = 21 }: { kind: ItemKind; size?: number }) {
  return <Icon name={kindIconMap[kind]} size={size} />;
}
