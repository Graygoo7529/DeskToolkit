// IPC 封装 —— invoke 命令 + 事件订阅 hook。签名严格对应 docs/architecture.md §7/§8。
import { useEffect, useRef } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import type {
  Bootstrap,
  ChatEvent,
  HotRegion,
  PanelTab,
  PanelTabPayload,
  PetSignal,
  QuotaInfo,
} from './types'

// ---------- 命令（前端 → Rust） ----------

export function updateHotRegions(regions: HotRegion[]): Promise<void> {
  return invoke('update_hot_regions', { regions })
}

export function openPanel(tab: PanelTab): Promise<void> {
  return invoke('open_panel', { tab })
}

export function closePanel(): Promise<void> {
  return invoke('close_panel')
}

export function chatSend(text: string): Promise<void> {
  return invoke('chat_send', { text })
}

export function chatCancel(): Promise<void> {
  return invoke('chat_cancel')
}

export function chatPermissionResponse(requestId: string, optionId: string): Promise<void> {
  return invoke('chat_permission_response', { requestId, optionId })
}

export function quotaRefresh(): Promise<QuotaInfo> {
  return invoke('quota_refresh')
}

export function getQuotaCached(): Promise<QuotaInfo | null> {
  return invoke('get_quota_cached')
}

export function getBootstrap(): Promise<Bootstrap> {
  return invoke('get_bootstrap')
}

// ---------- 事件（Rust → 前端） ----------

/**
 * 订阅 Tauri 事件。handler 通过 ref 持有，避免每次渲染重新订阅。
 */
export function useTauriEvent<T>(event: string, handler: (payload: T) => void): void {
  const handlerRef = useRef(handler)
  handlerRef.current = handler

  useEffect(() => {
    let unlisten: (() => void) | undefined
    let disposed = false
    listen<T>(event, (e) => handlerRef.current(e.payload))
      .then((u) => {
        if (disposed) u()
        else unlisten = u
      })
      .catch(() => {
        // 非 Tauri 环境（纯 vite 调试）下静默失败
      })
    return () => {
      disposed = true
      unlisten?.()
    }
  }, [event])
}

// 具体事件的便捷 hook，附带 payload 类型
export function usePetSignal(handler: (payload: PetSignal) => void): void {
  useTauriEvent<PetSignal>('pet://signal', handler)
}

export function usePanelTabEvent(handler: (payload: PanelTabPayload) => void): void {
  useTauriEvent<PanelTabPayload>('panel://tab', handler)
}

export function useChatEvent(handler: (payload: ChatEvent) => void): void {
  useTauriEvent<ChatEvent>('chat://event', handler)
}

export function useQuotaUpdated(handler: (payload: QuotaInfo) => void): void {
  useTauriEvent<QuotaInfo>('quota://updated', handler)
}
