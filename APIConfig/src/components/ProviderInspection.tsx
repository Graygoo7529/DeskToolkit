import { useEffect, useState } from 'react'
import QuotaPanel from './QuotaPanel'
import Icon from './Icon'
import type { ApiProbeProfile, ProbeSlot, ProbeTask, ProviderResults } from '../types'

export const taskLabels: Record<ProbeTask, string> = { connection: '连接测试', models: '模型发现', quota: '额度查询' }
const resultLabels = { ok: '成功', partial: '部分可用', error: '失败', skipped: '已跳过' }
const when = (value: number) => new Date(value).toLocaleString()


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

export default function ProviderInspection({ results = {}, busy, profile, color, configuredQuota, onRun }: {
  results?: ProviderResults
  busy: boolean
  configuredQuota: boolean
  profile?: ApiProbeProfile
  color: string
  onRun: (task: ProbeTask) => void
}) {
  const [queuedAutoTasks, setQueuedAutoTasks] = useState<ProbeTask[]>([])

  useEffect(() => {
    if (busy || !queuedAutoTasks.length) return
    const [task, ...remaining] = queuedAutoTasks
    setQueuedAutoTasks(remaining)
    const slot = results[task]
    if (!slot?.result && !slot?.pending && !(task === 'quota' && !configuredQuota)) onRun(task)
  }, [busy, configuredQuota, onRun, queuedAutoTasks, results])

  return <div className="provider-inspection">
    {(['connection', 'models', 'quota'] as const).map((task) => {
      const slot = results[task] ?? {}
      const result = slot.result
      const label = slot.pending === 'running' ? '查询中…' : slot.pending === 'queued' ? '排队中' : result ? resultLabels[result.status] : task === 'quota' && !configuredQuota ? '未配置' : '未查询'
      const stale = result && slot.lastGood && result !== slot.lastGood
      return <details className="probe" key={task} onToggle={(event) => {
        if (!event.currentTarget.open) {
          setQueuedAutoTasks((queued) => queued.filter((queuedTask) => queuedTask !== task))
          return
        }
        if (task === 'connection' || (task === 'quota' && !configuredQuota)) return
        if (!slot.result && !slot.pending) setQueuedAutoTasks((queued) => queued.includes(task) ? queued : [...queued, task])
      }}>
        <summary>
          <span>{taskLabels[task]}</span>
          <span className={`probe-status ${slot.pending ? 'pending' : result?.status ?? ''}`}>{label}{task === 'models' && slot.lastGood ? ` · ${slot.lastGood.models.length}` : ''}</span>
          {task !== 'connection' && <button type="button" className="probe-refresh icon-btn" aria-label={`刷新${taskLabels[task]}`} title={`刷新${taskLabels[task]}`}
            disabled={busy || !!slot.pending || (task === 'quota' && !configuredQuota)} onClick={(event) => {
              event.preventDefault()
              event.stopPropagation()
              onRun(task)
            }}><Icon name="refresh" size={14} /></button>}
        </summary>
        <div className="probe-body">
          {task !== 'quota' && <p className="hint">{result?.message ?? (task === 'connection' ? '读取模型接口，检查网络与认证；不执行模型生成。' : '获取此密钥可见的模型列表，查询失败仍可应用 Provider。')}</p>}
          {result && <p className="probe-time">{when(result.checked_at)} · {result.latency_ms} ms{result.http_status ? ` · HTTP ${result.http_status}` : ''}</p>}
          {stale && <p className="stale">以下保留上次可用结果 · {when(slot.lastGood!.checked_at)}</p>}
          {task === 'models' && <ModelList slot={slot} />}
          {task === 'quota' && <QuotaPanel profile={profile} color={color} loading={!!slot.pending} result={result ? { ...result, quota: result.quota ?? slot.lastGood?.quota ?? null } : null} />}
        </div>
      </details>
    })}
  </div>
}
