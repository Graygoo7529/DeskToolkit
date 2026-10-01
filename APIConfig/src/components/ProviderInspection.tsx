import { useState } from 'react'
import type { ProbeSlot, ProbeTask, ProviderResults } from '../types'

export const taskLabels: Record<ProbeTask, string> = { connection: '连接测试', models: '模型发现', quota: '额度查询' }
const resultLabels = { ok: '成功', partial: '部分可用', error: '失败', skipped: '已跳过' }
const when = (value: number) => new Date(value).toLocaleString()
const number = (n: number | null | undefined) => n == null ? '—' : n.toLocaleString(undefined, { maximumFractionDigits: 4 })

function ModelList({ slot }: { slot: ProbeSlot }) {
  const [search, setSearch] = useState('')
  const models = slot.lastGood?.models ?? []
  const filtered = models.filter((m) => `${m.id} ${m.name ?? ''}`.toLowerCase().includes(search.toLowerCase()))
  if (!slot.lastGood) return null
  return <div className="model-results">
    <label className="field"><span>模型列表 · {models.length} 个</span>
      <input aria-label="搜索模型" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜索模型名称或 ID" /></label>
    <ul className="model-list">{filtered.map((m) => <li key={m.id}><code>{m.id}</code>{m.name && m.name !== m.id && <small>{m.name}</small>}</li>)}</ul>
    {!filtered.length && <p className="hint">{models.length ? '没有匹配的模型。' : '接口返回空模型列表。'}</p>}
  </div>
}

function QuotaResult({ slot }: { slot: ProbeSlot }) {
  const quota = slot.lastGood?.quota
  if (!quota) return null
  return <div className="quota-results">
    <div className="metric-row"><span>余额</span><strong>{number(quota.balance)} {quota.balance !== null && quota.unit}</strong></div>
    {quota.membership && <div className="metric-row"><span>会员等级</span><span>{quota.membership.replace(/^LEVEL_/, '')}</span></div>}
    {quota.windows.map((w) => <div className="quota-window" key={w.name}>
      <div className="metric-row"><strong>{w.name}</strong><span>剩余 {number(w.remaining)} {w.remaining !== null && quota.unit}</span></div>
      {w.limit !== null && w.limit > 0 && w.remaining !== null && <progress aria-label={`${w.name}剩余比例`} max={w.limit} value={Math.max(0, Math.min(w.remaining, w.limit))} />}
      <div className="metric-row dim"><span>已用 {number(w.used)}</span><span>总额度 {number(w.limit)}</span></div>
      <small className="dim">重置：{w.reset_at ? (Number.isNaN(Date.parse(w.reset_at)) ? w.reset_at : new Date(w.reset_at).toLocaleString()) : '—'}</small>
    </div>)}
  </div>
}

export default function ProviderInspection({ results = {}, busy, configuredQuota, onRun, onSettings }: {
  results?: ProviderResults
  busy: boolean
  configuredQuota: boolean
  onRun: (task: ProbeTask) => void
  onSettings: () => void
}) {
  return <div className="provider-inspection" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
    {(['connection', 'models', 'quota'] as const).map((task) => {
      const slot = results[task] ?? {}
      const result = slot.result
      const label = slot.pending === 'running' ? '查询中…' : slot.pending === 'queued' ? '排队中' : result ? resultLabels[result.status] : task === 'quota' && !configuredQuota ? '未配置' : '未查询'
      const stale = result && slot.lastGood && result !== slot.lastGood
      return <details className="probe" key={task}>
        <summary><span>{taskLabels[task]}</span><span className={`probe-status ${slot.pending ? 'pending' : result?.status ?? ''}`}>{label}{task === 'models' && slot.lastGood ? ` · ${slot.lastGood.models.length}` : ''}</span></summary>
        <div className="probe-body">
          <p className="hint">{result?.message ?? (task === 'connection' ? '读取模型接口，检查网络与认证；不执行模型生成。' : task === 'models' ? '获取此密钥可见的模型列表，查询失败仍可应用 Provider。' : configuredQuota ? '手动查询额度；缺失字段会显示 —。' : '此 Provider 尚未设置额度接口，可在查询设置中选择适配器。')}</p>
          {result && <p className="probe-time">{when(result.checked_at)} · {result.latency_ms} ms{result.http_status ? ` · HTTP ${result.http_status}` : ''}</p>}
          {stale && <p className="stale">以下保留上次可用结果 · {when(slot.lastGood!.checked_at)}</p>}
          {task === 'models' && <ModelList slot={slot} />}
          {task === 'quota' && <QuotaResult slot={slot} />}
          <div className="probe-actions">
            <button className="btn btn-ghost" disabled={busy || (task === 'quota' && !configuredQuota)} onClick={() => onRun(task)}>{slot.pending ? label : taskLabels[task]}</button>
            <button className="btn btn-ghost" disabled={busy} onClick={onSettings}>查询设置</button>
          </div>
        </div>
      </details>
    })}
  </div>
}
