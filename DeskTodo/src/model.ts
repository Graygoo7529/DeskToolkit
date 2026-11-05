export type Note = { id: string; title: string; content: string; color: string; updatedAt: number };
export type Cluster = { id: string; name: string; icon: string; color: string; notes: Note[] };
export type Workspace = { clusters: Cluster[] };
export const colors = ["#8fa9f7", "#88c9b6", "#dfb18a", "#b8a1dd", "#d58f9c"];
export const uid = () => crypto.randomUUID();
export const LEGACY_KEY = "desktodo-workspace-v1";
export const CACHE_KEY = "desktodo-workspace-v2";

export function parseWorkspace(raw: string): Workspace {
  const value = JSON.parse(raw) as Workspace;
  if (!value || !Array.isArray(value.clusters) || !value.clusters.length) throw new Error("数据文件中没有有效的 note 夹。");
  const ids = new Set<string>();
  for (const c of value.clusters) {
    if (!c || typeof c.id !== "string" || ids.has(c.id) || typeof c.name !== "string" || !Array.isArray(c.notes)) throw new Error("note 夹数据格式不正确。");
    ids.add(c.id);
    for (const n of c.notes) {
      if (!n || typeof n.id !== "string" || ids.has(n.id) || typeof n.title !== "string" || typeof n.content !== "string" || !Number.isFinite(n.updatedAt)) throw new Error("便签数据格式不正确。");
      ids.add(n.id);
    }
  }
  return value;
}

export function createWorkspace(): Workspace {
  return { clusters: [{ id: uid(), name: "收件箱", icon: "folder", color: colors[0], notes: [{
    id: uid(), title: "随手记", color: colors[0], updatedAt: Date.now(),
    content: "# 给今天留一点空间\n\n记下一个想法，或从一件小事开始。\n\n```todo\n- [ ] 写下今天最重要的一件事\n```\n\n在空行输入 /，添加待办纸或公式。\n",
  }] }] };
}
export function newNote(): Note {
  return { id: uid(), title: "未命名便签", content: "", color: colors[0], updatedAt: Date.now() };
}
export const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);

