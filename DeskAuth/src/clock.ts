import { api } from './api'
import type { OtpCode, TimeStatus } from './types'

export interface TimedCode { value: OtpCode; requestedAt: number; localRequestedAt: number }

export async function readTimedCode(id: string): Promise<TimedCode> {
  const requestedAt = performance.now()
  const localRequestedAt = Date.now()
  return { value: await api.code(id), requestedAt, localRequestedAt }
}

// Keep every display/copy check on the backend's clock. Counting from request
// start is conservative: IPC latency can shorten, never extend, validity.
export function codeTiming(frame: TimedCode | null, revision?: number) {
  if (!frame) return { valid: false, remaining: 0 }
  const elapsed = performance.now() - frame.requestedAt
  const wallElapsed = Date.now() - frame.localRequestedAt
  const now = frame.value.generatedAt + Math.max(elapsed, wallElapsed)
  const valid = elapsed >= 0 && Math.abs(elapsed - wallElapsed) < 2000
    && now < frame.value.validUntil
    && (revision === undefined || frame.value.timeStatus.revision >= revision)
  return { valid, remaining: valid ? Math.max(0, Math.min(frame.value.period, Math.ceil((frame.value.validUntil - now) / 1000))) : 0 }
}

export function timeLabel(status: TimeStatus | null) {
  if (!status) return '时间状态未就绪'
  if (!status.enabled) return '本地时间 · 离线'
  if (status.syncing) return '正在校时'
  if (status.source === 'network') return status.error ? '校时失败 · 沿用校正' : '网络时间已校正'
  return status.error ? '校时失败 · 本地时间' : '等待校时 · 本地时间'
}
