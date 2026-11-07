import { invoke, isTauri } from "@tauri-apps/api/core";
import { CACHE_KEY, LEGACY_KEY, parseWorkspace, type Workspace } from "./model";

export const desktop = isTauri();
export interface StorageState { dataDir: string | null; suggestedDir: string }
export interface Loaded { dataDir: string; workspace: Workspace }
export interface ViewState { clusterId: string; noteId: string; scrollTop: number; source: boolean }
const VIEW_STATE_KEY = "desktodo-view-v1";
const BROWSER_PATH = "浏览器本地存储";
export async function getStorageState(): Promise<StorageState> {
  if (desktop) return invoke("get_state");
  return { dataDir: localStorage.getItem("desktodo-browser-ready") ? BROWSER_PATH : null, suggestedDir: BROWSER_PATH };
}
export function legacyWorkspace(): Workspace | null {
  // Keep both old keys intact after migration.
  const raw = localStorage.getItem(CACHE_KEY) || localStorage.getItem(LEGACY_KEY);
  return raw ? parseWorkspace(raw) : null;
}
export async function readWorkspace(): Promise<Loaded> {
  if (desktop) return invoke("load_workspace");
  const raw = localStorage.getItem(CACHE_KEY);
  if (!raw) throw new Error("本地数据不存在，请重新选择数据目录。");
  return { dataDir: BROWSER_PATH, workspace: parseWorkspace(raw) };
}
export async function changeDirectory(path: string, seed: Workspace): Promise<Loaded> {
  if (desktop) return invoke("set_data_dir", { path, seed });
  localStorage.setItem(CACHE_KEY, JSON.stringify(seed));
  localStorage.setItem("desktodo-browser-ready", "yes");
  return { dataDir: BROWSER_PATH, workspace: seed };
}
export async function persist(path: string, workspace: Workspace) {
  if (desktop) await invoke("save_workspace", { path, workspace });
  else localStorage.setItem(CACHE_KEY, JSON.stringify(workspace));
}
// Browser localStorage is synchronous, so it can be used as the unload fallback
// when the page is closed before the asynchronous debounce has fired.
export function persistSync(workspace: Workspace) {
  try { if (!desktop) localStorage.setItem(CACHE_KEY, JSON.stringify(workspace)); } catch { /* The unload path must not block the browser from closing. */ }
}
export function readViewState(dataDir: string): ViewState | null {
  try {
    const all = JSON.parse(localStorage.getItem(VIEW_STATE_KEY) || "{}") as Record<string, Partial<ViewState>>;
    const value = all[dataDir];
    if (!value || typeof value.clusterId !== "string" || typeof value.noteId !== "string" || !Number.isFinite(value.scrollTop)) return null;
    const scrollTop = value.scrollTop as number;
    return { clusterId: value.clusterId, noteId: value.noteId, scrollTop: Math.max(0, scrollTop), source: value.source === true };
  } catch { return null; }
}
export function writeViewState(dataDir: string, value: ViewState) {
  try {
    const all = JSON.parse(localStorage.getItem(VIEW_STATE_KEY) || "{}") as Record<string, ViewState>;
    all[dataDir] = { ...value, scrollTop: Math.max(0, value.scrollTop) };
    localStorage.setItem(VIEW_STATE_KEY, JSON.stringify(all));
  } catch { /* A session snapshot must never block note editing. */ }
}
export async function browseDirectory(): Promise<string | null> {
  if (!desktop) return null;
  const { open } = await import("@tauri-apps/plugin-dialog");
  const chosen = await open({ directory: true, multiple: false, title: "选择 DeskTodo 数据目录" });
  return typeof chosen === "string" ? chosen : null;
}
export async function openDirectory() {
  if (desktop) await invoke("open_data_dir");
}
export async function openNoteFile(noteId: string) {
  if (desktop) await invoke("open_note_file", { noteId });
}
export async function preserveAndReload(path: string, workspace: Workspace): Promise<Loaded> {
  return invoke("preserve_and_reload", { path, workspace });
}
// Serialize writes and coalesce pending typing; never issue a late write after a directory switch.
export class SaveQueue {
  private tail: Promise<void> = Promise.resolve();
  private revision = 0;
  save(path: string, workspace: Workspace): Promise<void> {
    const ticket = ++this.revision;
    const task = this.tail.catch(() => undefined).then(async () => {
      if (ticket === this.revision) await persist(path, workspace);
    });
    this.tail = task;
    return task;
  }
  async flush() { await this.tail; }
  // Only after all pending writes have settled and a replacement workspace has loaded.
  reset() { this.revision++; this.tail = Promise.resolve(); }
}
