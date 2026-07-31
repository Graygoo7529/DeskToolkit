// 额度 tab —— 双环 SVG + 明细 + 刷新（契约 §12）。
import { useCallback, useEffect, useState } from 'react'
import { getQuotaCached, quotaRefresh, useQuotaUpdated } from '../shared/ipc'
import type { QuotaInfo, QuotaWindow } from '../shared/types'

function pct(w: QuotaWindow | null): number | null {
  if (!w || w.limit <= 0) return null
  return Math.max(0, Math.min(100, (w.remaining / w.limit) * 100))
}

function fmtNum(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1)
}

function fmtReset(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString()
}

function fmtRelative(iso: string): string {
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return '—'
  const diff = Date.now() - t
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
  return `${Math.floor(diff / 86_400_000)} 天前`
}

function fmtLevel(level: string | null): string {
  if (!level) return '未知'
  return level.replace(/^LEVEL_/, '')
}

/** 单个圆环 */
function Ring({ r, sw, value, color, track }: { r: number; sw: number; value: number | null; color: string; track: string }) {
  const c = 2 * Math.PI * r
  const filled = value == null ? 0 : (value / 100) * c
  return (
    <>
      <circle cx="84" cy="84" r={r} fill="none" stroke={track} strokeWidth={sw} />
      <circle
        cx="84"
        cy="84"
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={sw}
        strokeDasharray={`${filled} ${c - filled}`}
        strokeLinecap="butt"
        transform="rotate(-90 84 84)"
        style={{ transition: 'stroke-dasharray 300ms' }}
      />
    </>
  )
}

export default function QuotaTab({ visible }: { visible: boolean }) {
  const [quota, setQuota] = useState<QuotaInfo | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  // 相对时间每 30s 重算
  const [, setNowTick] = useState(0)

  useEffect(() => {
    let dead = false
    getQuotaCached()
      .then((q) => {
        if (!dead && q) setQuota(q)
      })
      .catch(() => {})
    const t = setInterval(() => setNowTick((n) => n + 1), 30_000)
    return () => {
      dead = true
      clearInterval(t)
    }
  }, [])

  useQuotaUpdated(
    useCallback((q) => {
      setQuota(q)
    }, []),
  )

  const refresh = () => {
    setRefreshing(true)
    quotaRefresh()
      .then(setQuota)
      .catch(() => {})
      .finally(() => setRefreshing(false))
  }

  const weeklyPct = pct(quota?.weekly ?? null)
  const fivePct = pct(quota?.fiveHour ?? null)

  return (
    <div className="quota-tab" style={{ display: visible ? 'flex' : 'none' }}>
      {!quota ? (
        <div className="quota-empty">
          <p>暂无数据（检查 API Key）</p>
          <button className="quota-refresh" onClick={refresh} disabled={refreshing}>
            {refreshing ? '刷新中…' : '刷新'}
          </button>
        </div>
      ) : (
        <>
          <div className="quota-rings">
            <svg width="168" height="168" viewBox="0 0 168 168">
              <Ring r={70} sw={12} value={weeklyPct} color="#5eead4" track="rgba(19,78,74,0.35)" />
              <Ring r={52} sw={10} value={fivePct} color="#fbbf24" track="rgba(19,78,74,0.35)" />
            </svg>
            <div className="quota-center">
              <div className="quota-big">{weeklyPct == null ? '--' : `${Math.round(weeklyPct)}%`}</div>
              <div className="quota-label">周额度剩余</div>
            </div>
          </div>

          <div className="quota-rows">
            <div className="quota-row">
              <span className="qr-dot" style={{ background: '#5eead4' }} />
              <span className="qr-name">周额度</span>
              <span className="qr-val">
                {quota.weekly ? `${fmtNum(quota.weekly.used)} / ${fmtNum(quota.weekly.limit)}` : '—'}
              </span>
              <span className="qr-sub">重置 {quota.weekly ? fmtReset(quota.weekly.resetAt) : '—'}</span>
            </div>
            <div className="quota-row">
              <span className="qr-dot" style={{ background: '#fbbf24' }} />
              <span className="qr-name">5 小时窗口</span>
              <span className="qr-val">
                {quota.fiveHour ? `${fmtNum(quota.fiveHour.used)} / ${fmtNum(quota.fiveHour.limit)}` : '—'}
              </span>
              <span className="qr-sub">重置 {quota.fiveHour ? fmtReset(quota.fiveHour.resetAt) : '—'}</span>
            </div>
            <div className="quota-row">
              <span className="qr-name">会员等级</span>
              <span className="qr-badge">{fmtLevel(quota.membershipLevel)}</span>
            </div>
            <div className="quota-row">
              <span className="qr-name">更新于</span>
              <span className="qr-sub">{fmtRelative(quota.fetchedAt)}</span>
            </div>
          </div>

          <button className="quota-refresh" onClick={refresh} disabled={refreshing}>
            {refreshing ? '刷新中…' : '刷新'}
          </button>
        </>
      )}
    </div>
  )
}
