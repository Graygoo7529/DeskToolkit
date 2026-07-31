// 跨端类型定义 —— 与 docs/architecture.md §5/§7/§8 的 Rust 结构体一一对应。

/** §5 点击穿透热区（相对 stage 窗口的逻辑 px） */
export interface HotRegion {
  id: string
  x: number
  y: number
  w: number
  h: number
}

/** §8 pet://signal */
export interface PetSignal {
  signal: 'landed' | 'chat_active' | 'chat_idle'
}

/** §8 panel://tab */
export type PanelTab = 'chat' | 'quota'

export interface PanelTabPayload {
  tab: PanelTab
}

/** §8 ChatEvent */
export type ChatEvent =
  | { type: 'session'; status: 'connecting' | 'ready' | 'error'; sessionId?: string; message?: string }
  | { type: 'chunk'; text: string }
  | { type: 'tool_call'; toolCallId: string; title: string; kind?: string; status: string }
  | { type: 'tool_call_update'; toolCallId: string; status: string; contentText?: string }
  | {
      type: 'permission'
      requestId: string
      title: string
      options: { optionId: string; name: string; kind: string }[]
    }
  | { type: 'done'; stopReason: string }
  | { type: 'error'; message: string }

/** §8 额度 */
export interface QuotaWindow {
  used: number
  limit: number
  remaining: number
  resetAt: string | null
}

export interface QuotaInfo {
  weekly: QuotaWindow | null
  fiveHour: QuotaWindow | null
  membershipLevel: string | null
  fetchedAt: string
}

/** §7 get_bootstrap 返回值 */
export interface Bootstrap {
  quota: QuotaInfo | null
  sessionActive: boolean
}
