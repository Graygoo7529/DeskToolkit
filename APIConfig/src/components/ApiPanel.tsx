import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { open } from '@tauri-apps/plugin-dialog'
import type { ApiAccount, ApiProbeResult, ProbeResult } from '../types'
import * as api from '../api'
import Icon from './Icon'
import { ModalShell } from './Modals'

type Protocol = 'openai' | 'anthropic'
type AccountModalProps = {
  original: ApiAccount | null
  onClose: () => void
  onSave: (original: string | null, name: string, url: string, anthropicUrl: string, key: string) => Promise<void>
  onDelete?: () => Promise<void>
}

function AccountModal({ original, onClose, onSave, onDelete }: AccountModalProps) {
  const [name, setName] = useState(original?.name ?? '')
  const [url, setUrl] = useState(original?.url ?? '')
  const [anthropicUrl, setAnthropicUrl] = useState(original?.anthropic_url ?? '')
  const [key, setKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const save = async () => {
    setSaving(true); setError('')
    try { await onSave(original?.name ?? null, name, url, anthropicUrl, key); onClose() }
    catch (e) { setError(String(e)) }
    finally { setSaving(false) }
  }
  const remove = async () => {
    if (!onDelete) return
    setSaving(true); setError('')
    try { await onDelete(); onClose() }
    catch (e) { setError(String(e)) }
    finally { setSaving(false) }
  }
  return <ModalShell title={original ? '编辑 API 账号' : '添加 API 账号'} onClose={() => !saving && onClose()}>
    <fieldset disabled={saving}>
      <label className="field"><span>名称</span><input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="例如 千问套餐" /></label>
      <label className="field"><span>OpenAI 兼容地址</span><input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…/compatible-mode/v1" /><small className="field-hint">用于模型发现与按需检查。</small></label>
      <label className="field"><span>Anthropic 消息地址（可选）</span><input value={anthropicUrl} onChange={(e) => setAnthropicUrl(e.target.value)} placeholder="https://…/apps/anthropic" /><small className="field-hint">模型检查时发送最多 1 个输出 token 的请求。</small></label>
      <label className="field"><span>API Key</span><div className="input-with-btn"><input type={showKey ? 'text' : 'password'} autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} placeholder={original ? '留空保留当前 Key' : '输入 API Key'} /><button type="button" className="btn btn-ghost" onClick={() => setShowKey((value) => !value)}>{showKey ? '隐藏' : '显示'}</button></div></label>
      <p className="hint">此账号用于管理和检查 API，不会应用到 Codex 或 Claude。</p>
    </fieldset>
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="modal-actions api-modal-actions">
      {onDelete && (confirmDelete
        ? <span className="delete-confirm"><span>确认删除此账号？</span><button className="text-btn danger" disabled={saving} onClick={() => void remove()}>确认删除</button></span>
        : <button className="text-btn danger modal-delete" disabled={saving} onClick={() => setConfirmDelete(true)}>删除账号</button>)}
      <span className="modal-actions-spacer" />
      <button className="btn btn-ghost" disabled={saving} onClick={onClose}>取消</button>
      <button className="btn btn-primary" disabled={saving || !name.trim() || !url.trim() || (!original && !key.trim())} onClick={() => void save()}>{saving ? '保存中…' : '保存'}</button>
    </div>
  </ModalShell>
}

function KimiAccountModal({ original, onClose, onSave }: { original: ApiAccount; onClose: () => void; onSave: (name: string, url: string, key: string) => Promise<void> }) {
  const [name, setName] = useState(original.name)
  const [url, setUrl] = useState(original.url)
  const [key, setKey] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const save = async () => {
    setSaving(true); setError('')
    try { await onSave(name, url, key); onClose() }
    catch (e) { setError(String(e)) }
    finally { setSaving(false) }
  }
  const importDeskbot = async () => {
    setSaving(true); setError('')
    try {
      const path = await open({ title: '选择 DeskBot 的 deskbot.local.json', filters: [{ name: 'DeskBot 配置', extensions: ['json'] }] })
      if (typeof path === 'string') {
        const imported = await api.importKimiConfig(path)
        await onSave(imported.name, imported.url, '')
        onClose()
      }
    } catch (e) { setError(String(e)) }
    finally { setSaving(false) }
  }
  return <ModalShell title="Kimi Code 账号" onClose={() => !saving && onClose()}>
    <fieldset disabled={saving}>
      <label className="field"><span>账号名称</span><input value={name} onChange={(e) => setName(e.target.value)} /></label>
      <label className="field"><span>服务地址</span><input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://api.kimi.com/coding/v1" /></label>
      <label className="field"><span>Kimi API Key</span><input type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} placeholder={original.configured ? '留空保留当前 Key' : '填写 Kimi Code Key'} /></label>
      <p className="hint">配置仍保存在 kimi.toml。可从 DeskBot 本地配置导入。</p>
      <button className="btn btn-ghost" onClick={() => void importDeskbot()}><Icon name="folder" size={15} />从 DeskBot 导入</button>
    </fieldset>
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="modal-actions"><button className="btn btn-ghost" disabled={saving} onClick={onClose}>取消</button><button className="btn btn-primary" disabled={saving || !name.trim() || !url.trim() || (!original.configured && !key.trim())} onClick={() => void save()}>{saving ? '保存中…' : '保存账号'}</button></div>
  </ModalShell>
}

function QuotaCard({ title, window, color }: { title: string; window?: NonNullable<ProbeResult['quota']>['windows'][number]; color: string }) {
  const percent = window?.remaining != null && window.limit != null && window.limit > 0
    ? Math.max(0, Math.min(100, window.remaining / window.limit * 100)) : null
  const reset = window?.reset_at
  const number = (value: number | null | undefined) => value == null ? '—' : value.toLocaleString(undefined, { maximumFractionDigits: 1 })
  return <article className="subscription-quota" style={{ '--quota-color': color } as CSSProperties}>
    <div className="subscription-quota-ring" style={{ '--fill': `${(percent ?? 0) * 3.6}deg` } as CSSProperties}>
      <div><strong>{percent == null ? '—' : Math.round(percent)}{percent != null && <small>%</small>}</strong><span>剩余</span></div>
    </div>
    <div className="subscription-quota-info"><div className="subscription-quota-head"><strong>{title}</strong><span>{window?.reset_at ? '周期额度' : '额度概览'}</span></div>
      <div className="subscription-quota-values"><span>已用<strong>{number(window?.used)}</strong></span><span>总量<strong>{number(window?.limit)}</strong></span><span>剩余<strong>{number(window?.remaining)}</strong></span></div>
      <small>{reset ? `重置于 ${Number.isNaN(Date.parse(reset)) ? reset : new Date(reset).toLocaleString()}` : '未提供重置时间'}</small>
    </div>
  </article>
}

function accountStatus(account: ApiAccount, result?: ApiProbeResult, refreshing?: boolean, error?: string) {
  if (!account.configured) return 'unconfigured'
  if (refreshing) return 'pending'
  if (error) return 'error'
  const status = result?.models.status
  return status === 'ok' || status === 'partial' ? 'ok' : status === 'error' ? 'error' : 'idle'
}

export default function ApiPanel({ visible, pushToast }: { visible: boolean; pushToast: (kind: 'success' | 'error', text: string) => void }) {
  const [accounts, setAccounts] = useState<ApiAccount[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [results, setResults] = useState<Record<string, ApiProbeResult>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [refreshing, setRefreshing] = useState<Record<string, boolean>>({})
  const [checks, setChecks] = useState<Record<string, ProbeResult>>({})
  const [checkingKey, setCheckingKey] = useState<string | null>(null)
  const [protocol, setProtocol] = useState<Protocol>('openai')
  const [accountSearch, setAccountSearch] = useState('')
  const [modelSearch, setModelSearch] = useState('')
  const [editing, setEditing] = useState<ApiAccount | null | undefined>(undefined)
  const opening = useRef(false)
  const selected = accounts.find((account) => account.id === selectedId) ?? null
  const result = selected ? results[selected.id] : undefined
  const filteredAccounts = useMemo(() => accounts.filter((account) => `${account.name} ${account.url}`.toLowerCase().includes(accountSearch.toLowerCase())), [accounts, accountSearch])
  const models = result?.models.models ?? []
  const shownModels = models.filter((item) => `${item.id} ${item.name ?? ''}`.toLowerCase().includes(modelSearch.toLowerCase()))

  const refreshAccount = async (account: ApiAccount) => {
    if (!account.configured) {
      setErrors((old) => ({ ...old, [account.id]: '请先设置 API Key。' }))
      return
    }
    setRefreshing((old) => ({ ...old, [account.id]: true }))
    setErrors((old) => ({ ...old, [account.id]: '' }))
    try {
      const next = await api.probeApiAccount(account.id)
      setResults((old) => {
        const previous = old[account.id]
        const preserveQuota = account.kind === 'kimi' && next.quota?.status === 'error' && previous?.quota?.quota
        return { ...old, [account.id]: preserveQuota ? { ...next, quota: { ...next.quota!, quota: previous.quota!.quota } } : next }
      })
      setChecks((old) => Object.fromEntries(Object.entries(old).filter(([key]) => !key.startsWith(`${account.id}:`))))
    } catch (e) { setErrors((old) => ({ ...old, [account.id]: String(e) })) }
    finally { setRefreshing((old) => ({ ...old, [account.id]: false })) }
  }

  const refreshAll = async (list = accounts) => {
    await Promise.all(list.filter((account) => account.configured).map((account) => refreshAccount(account)))
  }

  const load = async (autoRefresh: boolean) => {
    try {
      const next = await api.getApiAccounts()
      setAccounts(next)
      const selected = next.find((account) => account.id === selectedId) ?? next[0] ?? null
      setSelectedId(selected?.id ?? null)
      if (autoRefresh) void refreshAll(next)
    } catch (e) {
      if (selectedId) setErrors((old) => ({ ...old, [selectedId]: String(e) }))
      else pushToast('error', String(e))
    }
  }

  useEffect(() => {
    if (visible && !opening.current) {
      opening.current = true
      void load(true)
    } else if (!visible) opening.current = false
  }, [visible])

  const saveApi = async (original: string | null, name: string, url: string, anthropicUrl: string, key: string) => {
    const next = await api.saveApiAccount(original, name, url, anthropicUrl, key)
    setAccounts(next)
    const saved = next.find((account) => account.kind === 'api' && account.name === name.trim())
    if (saved) {
      setSelectedId(saved.id)
      setResults((old) => { const copy = { ...old }; if (original) delete copy[`api:${original}`]; delete copy[saved.id]; return copy })
      void refreshAccount(saved)
    }
    pushToast('success', `已保存 API「${name.trim()}」`)
  }

  const saveKimi = async (name: string, url: string, key: string) => {
    await api.saveKimiConfig(name, url, key)
    const next = await api.getApiAccounts()
    setAccounts(next)
    const kimi = next.find((account) => account.kind === 'kimi')
    if (kimi) { setSelectedId(kimi.id); setResults((old) => { const copy = { ...old }; delete copy.kimi; return copy }); void refreshAccount(kimi) }
    pushToast('success', '已保存 Kimi Code 账号')
  }

  const remove = async (account: ApiAccount) => {
    const next = await api.deleteApiAccount(account.name)
    setAccounts(next)
    setResults((old) => { const copy = { ...old }; delete copy[account.id]; return copy })
    setSelectedId(next.find((item) => item.id !== 'kimi')?.id ?? 'kimi')
    pushToast('success', `已移除「${account.name}」`)
  }

  const checkModel = async (model: string) => {
    if (!selected || checkingKey) return
    const key = `${selected.id}:${protocol}:${model}`
    setCheckingKey(key)
    try {
      const next = await api.checkApiModel(selected.id, model, protocol)
      setChecks((old) => ({ ...old, [key]: next }))
    } catch (e) {
      setChecks((old) => ({ ...old, [key]: { status: 'error', message: String(e), checked_at: Date.now(), latency_ms: 0, http_status: null, models: [], quota: null } }))
    } finally { setCheckingKey(null) }
  }

  const modelCheckKey = (model: string) => selected ? `${selected.id}:${protocol}:${model}` : ''
  const selectedBusy = selected ? !!refreshing[selected.id] : false
  const allBusy = Object.values(refreshing).some(Boolean)
  const quota = result?.quota?.quota
  return <section className="api-panel">
    <div className="api-heading"><div><span className="eyebrow">API SUBSCRIPTIONS</span><h2>API 订阅 <span className="count">{accounts.length}</span></h2><p>查看账号额度、模型和接口可用性。</p></div><button className="btn btn-primary" onClick={() => setEditing(null)}><Icon name="plus" size={15} />添加 API</button></div>
    <div className="api-workspace">
      <aside className="api-accounts"><div className="api-list-head"><strong>账号</strong><button className="icon-btn" aria-label="刷新全部账号" title="刷新全部账号" disabled={allBusy} onClick={() => void refreshAll()}><Icon name="refresh" size={15} /></button></div>
        <label className="search-box"><Icon name="search" size={15} /><input aria-label="搜索 API" value={accountSearch} onChange={(e) => setAccountSearch(e.target.value)} placeholder="搜索名称或地址" /></label>
        <div className="api-list">{filteredAccounts.map((account) => {
          const status = accountStatus(account, results[account.id], refreshing[account.id], errors[account.id])
          const statusLabel = status === 'ok' ? '可用' : status === 'error' ? '异常' : status === 'pending' ? '刷新中' : status === 'unconfigured' ? '未配置 Key' : '尚未刷新'
          return <button key={account.id} style={{ '--provider-color': account.color } as CSSProperties} className={`api-account${selectedId === account.id ? ' active' : ''}`} onClick={() => { setSelectedId(account.id); setProtocol('openai'); setModelSearch('') }}>
            <span className="api-avatar">{account.name.slice(0, 1).toUpperCase()}</span><span className="api-account-copy"><strong>{account.name}</strong><small>{new URL(account.url).host}</small></span><span className={`api-account-dot ${status}`} role="img" aria-label={statusLabel} title={statusLabel} />
          </button>
        })}{!filteredAccounts.length && <div className="empty"><strong>{accounts.length ? '没有匹配的账号' : '还没有 API'}</strong><span>{accounts.length ? '调整搜索词试试。' : '添加 API 或配置 Kimi Code。'}</span></div>}</div>
      </aside>

      <main className="api-detail">{!selected ? <div className="api-empty"><div className="kimi-monogram">A</div><h3>建立你的 API 清单</h3><p>集中查看各个服务的额度、模型与可用性。</p><button className="btn btn-primary" onClick={() => setEditing(null)}>添加 API<Icon name="arrow" size={15} /></button></div> : <>
        <div className="api-detail-head"><div><span className="eyebrow">{selected.kind === 'kimi' ? 'KIMI CODE' : selected.url}</span><h3>{selected.name}</h3><span className="mono dim">{selected.key_masked || '尚未配置 API Key'}</span></div><div className="api-detail-actions"><button className="btn btn-primary" disabled={selectedBusy} onClick={() => void refreshAccount(selected)}><Icon name="refresh" size={15} />{selectedBusy ? '刷新中…' : '刷新'}</button><button className="icon-btn" aria-label="编辑账号" title="编辑账号" onClick={() => setEditing(selected)}><Icon name="more" size={17} /></button></div></div>
        {(errors[selected.id] || result?.models.status === 'error') && <div className="inline-error" role="alert"><span>{errors[selected.id] || result?.models.message}</span><button className="text-btn" disabled={selectedBusy} onClick={() => void refreshAccount(selected)}>重试</button></div>}

        <section className="api-quota-section"><div className="api-section-head"><div><span className="eyebrow">SUBSCRIPTION USAGE</span><h4>额度</h4></div>{selected.kind === 'kimi' && result?.quota?.quota?.membership && <span className="quota-membership">会员 {result.quota.quota.membership.replace(/^LEVEL_/, '')}</span>}</div>
          {selected.kind === 'kimi' && !selected.configured ? <div className="quota-notice"><span>还没有配置 Kimi Code Key</span><button className="text-btn" onClick={() => setEditing(selected)}>设置账号</button></div> : selected.kind === 'kimi' ? <>
            <div className="subscription-quota-grid"><QuotaCard title="周额度" window={quota?.windows.find((item) => item.name === '周额度')} color="#9CA9FF" /><QuotaCard title="5 小时窗口" window={quota?.windows.find((item) => item.name === '5 小时窗口')} color="#72D9C0" /></div>
            {result?.quota?.status === 'error' && <small className="quota-error">额度刷新失败：{result.quota.message}</small>}
          </> : <div className="quota-notice"><span>{selected.url.includes('maas.aliyuncs.com') ? '当前 Key 未提供订阅 Credits 查询接口' : '此 API 尚未提供可直接查询的订阅额度'}</span><small>{selected.url.includes('maas.aliyuncs.com') ? <>完成控制台授权后运行 <code>bl usage token-plan</code> 查看周额度和 5 小时额度。</> : '模型可用性与列表会独立刷新；额度以服务商控制台为准。'}</small></div>}
        </section>

        <section className="api-models"><div className="api-section-head api-model-head"><div><span className="eyebrow">MODEL DISCOVERY</span><h4>可用模型 <span className="count">{models.length}</span></h4></div><div className="api-model-tools">
          <div className="protocol-pills" role="group" aria-label="模型接口协议"><button className={protocol === 'openai' ? 'active' : ''} aria-pressed={protocol === 'openai'} onClick={() => setProtocol('openai')}>OpenAI</button>{selected.kind === 'api' && selected.anthropic_url && <button className={protocol === 'anthropic' ? 'active' : ''} aria-pressed={protocol === 'anthropic'} onClick={() => setProtocol('anthropic')}>Anthropic</button>}</div>
          <label className="search-box"><Icon name="search" size={14} /><input aria-label="过滤模型" value={modelSearch} onChange={(e) => setModelSearch(e.target.value)} placeholder="过滤模型" /></label>
        </div></div>
          <p className="model-check-hint">选择接口协议后，点击模型名称检查可用性。</p>
          <div className="api-model-list">{shownModels.map((item) => {
            const key = modelCheckKey(item.id)
            const checked = checks[key]
            const isChecking = checkingKey === key
            const status = isChecking ? 'pending' : checked?.status ?? 'idle'
            return <button type="button" className={`api-model-row ${status}`} key={item.id} title={checked?.message ?? `检查 ${item.id} · ${protocol === 'openai' ? 'OpenAI' : 'Anthropic'}`} onClick={() => void checkModel(item.id)} disabled={!!checkingKey}>
              <span className={`model-dot ${status}`} /><strong>{item.id}</strong>{item.name && <small>{item.name}</small>}{checked && <span className="model-latency">{checked.latency_ms} ms</span>}
            </button>
          })}{!shownModels.length && result?.models.status !== 'error' && <div className="empty"><strong>{models.length ? '没有匹配的模型' : result ? '没有返回模型' : selectedBusy ? '正在读取模型列表…' : selected.configured ? '等待模型刷新' : '尚未配置 API Key'}</strong><span>{models.length ? '调整过滤词试试。' : result?.models.message ?? (selected.configured ? '点击刷新获取模型。' : '设置账号后即可发现模型。')}</span></div>}{result?.models.status === 'error' && !models.length && <div className="empty"><strong>模型列表暂不可用</strong><span>{result.models.message}</span></div>}</div>
        </section>
      </>}</main>
    </div>

    {editing === null && <AccountModal original={null} onClose={() => setEditing(undefined)} onSave={saveApi} />}
    {editing?.kind === 'api' && <AccountModal original={editing} onClose={() => setEditing(undefined)} onSave={saveApi} onDelete={() => remove(editing)} />}
    {editing?.kind === 'kimi' && <KimiAccountModal original={editing} onClose={() => setEditing(undefined)} onSave={saveKimi} />}
  </section>
}
