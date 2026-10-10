import type { CSSProperties } from 'react'
import type { ApiProbeProfile, ProbeResult } from '../types'

type Quota = NonNullable<ProbeResult['quota']>
type Window = Quota['windows'][number]
const number = (value: number | null | undefined) => value == null ? '—' : value.toLocaleString(undefined, { maximumFractionDigits: 2 })

function QuotaCard({ title, component, window, color, balance, unit }: {
  title: string
  component: 'balance_card' | 'quota_card'
  window?: Window
  color: string
  balance?: number | null
  unit?: string
}) {
  const isQuota = component === 'quota_card'
  const percent = isQuota && window?.remaining != null && window.limit != null && window.limit > 0
    ? Math.max(0, Math.min(100, window.remaining / window.limit * 100)) : null
  const fill = percent ?? (!isQuota && balance != null ? 100 : 0)
  const reset = window?.reset_at
  return <article className="subscription-quota" data-component={component} style={{ '--quota-color': color } as CSSProperties}>
    <div className="subscription-quota-ring" style={{ '--fill': `${fill * 3.6}deg` } as CSSProperties}>
      <div><strong>{percent != null ? <>{Math.round(percent)}<small>%</small></> : number(isQuota ? window?.remaining : balance)}</strong><span>{isQuota ? '剩余' : unit || '余额'}</span></div>
    </div>
    <div className="subscription-quota-info">
      <div className="subscription-quota-head"><strong>{title}</strong><span>{isQuota ? '周期额度' : '账户余额'}</span></div>
      {isQuota ? <div className="subscription-quota-values">
        <span>已用<strong>{number(window?.used)}</strong></span><span>总量<strong>{number(window?.limit)}</strong></span><span>剩余<strong>{number(window?.remaining)}</strong></span>
      </div> : <div className="subscription-quota-values"><span>余额<strong>{number(balance)}</strong></span><span>单位<strong>{unit || '—'}</strong></span></div>}
      <small>{isQuota ? (reset ? `重置于 ${Number.isNaN(Date.parse(reset)) ? reset : new Date(reset).toLocaleString()}` : '未提供重置时间') : '服务商账户余额'}{isQuota && unit ? ` · ${unit}` : ''}</small>
    </div>
  </article>
}

/** Layout declares the cards, their order and labels; responses only fill slots. */
export default function QuotaPanel({ profile, result, color, loading }: {
  profile?: ApiProbeProfile
  result?: ProbeResult | null
  color: string
  loading: boolean
}) {
  const quota = result?.quota
  const blocks = profile?.blocks ?? []
  const cards = blocks.filter((block) => block.component === 'balance_card' || block.component === 'quota_card')
  const memberships = blocks.filter((block) => block.component === 'membership')
  return <section className="api-quota-section">
    <div className="api-section-head"><div><span className="eyebrow">ACCOUNT USAGE</span><h4>{profile?.layout_label || '额度 / 余额'}</h4></div>
      {quota?.membership && memberships.map((block, index) => <span key={index} className="quota-membership">{block.title} {quota.membership?.replace(/^LEVEL_/, '')}</span>)}
    </div>
    {(result?.status === 'error' || result?.status === 'partial') && <div className={result.status === 'error' ? 'inline-error' : 'quota-notice'} role="status">{result.message}</div>}
    {cards.length > 0 ? <div className="subscription-quota-grid" aria-busy={loading}>
      {cards.map((block, index) => <QuotaCard key={`${block.source}:${index}`} title={block.title} component={block.component as 'balance_card' | 'quota_card'}
        window={quota?.windows.find((window) => `windows.${window.id}` === block.source)} balance={quota?.balance} unit={quota?.unit}
        color={index ? '#72D9C0' : color} />)}
    </div> : <div className="quota-notice"><span>{profile?.kind === 'none' ? '未配置额度适配器' : '额度布局未加载，请检查定义文件'}</span></div>}
  </section>
}
