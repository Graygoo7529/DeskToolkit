export type IconName = "folder" | "plus" | "copy" | "trash" | "search" | "settings" | "undo" | "redo" | "code" | "edit";
const paths: Record<IconName, string> = {
  folder: "M3 7V5a2 2 0 0 1 2-2h5l3 3h6a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z",
  plus: "M12 5v14M5 12h14",
  copy: "M8 8h12v12H8zM16 4H4v12",
  trash: "M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7",
  search: "M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z",
  settings: "M4 7h16M4 17h16M8 4v6M16 14v6",
  undo: "M8 4 3 9l5 5M3 9h10a7 7 0 0 1 7 7v4",
  redo: "m16 4 5 5-5 5M21 9H11a7 7 0 0 0-7 7v4",
  code: "m8 5-6 7 6 7m8-14 6 7-6 7M14 3l-4 18",
  edit: "m4 16 12-12 4 4L8 20H4v-4ZM14 6l4 4",
};
export default function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}

