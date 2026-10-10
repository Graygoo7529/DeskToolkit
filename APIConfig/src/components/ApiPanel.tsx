import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import type { ApiAccount, ApiEndpoint, ApiProbeResult, ApiProtocol, ApiQuotaSettings, ApiProbeProfile, ProbeResult } from '../types'
import * as api from '../api'
import Icon from './Icon'
import { ModalShell } from './Modals'
import SortableList from './SortableList'
import QuotaPanel from './QuotaPanel'

const protocolLabels: Record<ApiProtocol, string> = {
  openai: 'OpenAI',
  openai_responses: 'Responses',
  anthropic: 'Anthropic',
  genai: 'GenAI',
  vertexai: 'VertexAI',
}
const protocolDefaults: Record<ApiProtocol, string> = {
  openai: 'https://…/v1',
  openai_responses: 'https://…/v1',
  anthropic: 'https://…/apps/anthropic',
  genai: 'https://generativelanguage.googleapis.com/v1beta',
  vertexai: 'https://aiplatform.googleapis.com/v1',
}
const emptyQuota = (): ApiQuotaSettings => ({ profile: 'none', presentation: 'balance', path: '', auth: 'bearer', balance_pointer: '', used_pointer: '', limit_pointer: '', remaining_pointer: '', reset_pointer: '', unit: '' })
const makeEndpoint = (protocol: ApiProtocol, url = ''): ApiEndpoint => ({ protocol, url, auth: protocol === 'anthropic' || protocol === 'genai' || protocol === 'vertexai' ? 'x_api_key' : 'bearer' })
function normalizeAccount(raw: ApiAccount): ApiAccount {
  const endpoints = raw.endpoints?.length ? raw.endpoints : [makeEndpoint('openai', raw.url)]
  const profile = raw.quota?.profile || raw.quota_adapter || raw.quota?.adapter || 'none'
  const quota = { ...emptyQuota(), ...raw.quota, profile }
  return { ...raw, endpoints, quota, quota_adapter: profile, console_url: raw.console_url ?? '' }
}
function normalizeProbe(raw: ApiProbeResult): ApiProbeResult {
  return { ...raw, model_sets: raw.model_sets ?? [] }
}

function ApiAccountModal({ original, profiles, onClose, onSave, onDelete, onRevealKey }: {
  original: ApiAccount | null
  profiles: ApiProbeProfile[]
  onClose: () => void
  onSave: (original: string | null, name: string, kind: 'subscription' | 'direct', endpoints: ApiEndpoint[], quota: ApiQuotaSettings, key: string, consoleUrl: string) => Promise<void>
  onDelete?: () => Promise<void>
  onRevealKey: (id: string) => Promise<string>
}) {
  const [name, setName] = useState(original?.name ?? '')
  const [kind, setKind] = useState<'subscription' | 'direct'>(original?.kind ?? 'direct')
  const [endpoints, setEndpoints] = useState<ApiEndpoint[]>(original?.endpoints?.length ? original.endpoints : [makeEndpoint('openai')])
  const [quota, setQuota] = useState<ApiQuotaSettings>(original ? { ...emptyQuota(), ...(original.quota ?? {}), profile: original.quota?.profile || original.quota_adapter || 'none' } : emptyQuota())
  const [consoleUrl, setConsoleUrl] = useState(original?.console_url ?? '')
  const [key, setKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [keyLoading, setKeyLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const revealKey = async () => {
    if (showKey) { setShowKey(false); return }
    if (!original || key) { setShowKey(true); return }
    setKeyLoading(true); setError('')
    try { setKey(await onRevealKey(original.id)); setShowKey(true) } catch (e) { setError(String(e)) } finally { setKeyLoading(false) }
  }
  const save = async () => { setSaving(true); setError(''); try { await onSave(original?.name ?? null, name, kind, endpoints.filter((e) => e.url.trim()), quota, key, consoleUrl); onClose() } catch (e) { setError(String(e)) } finally { setSaving(false) } }
  const updateEndpoint = (index: number, patch: Partial<ApiEndpoint>) => setEndpoints((old) => old.map((item, i) => i === index ? { ...item, ...patch, auth: patch.protocol && patch.protocol !== item.protocol ? makeEndpoint(patch.protocol).auth : patch.auth ?? item.auth } : item))
  return <ModalShell title={original ? '编辑 API 账号' : '添加 API 账号'} onClose={() => !saving && onClose()}>
    <fieldset disabled={saving}>
      <label className="field"><span>账号名称</span><input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="例如 Token Plan / DeepSeek" /></label>
      <div className="field"><span>账号类型</span><div className="segmented-control" role="group" aria-label="账号类型"><button type="button" className={kind === 'subscription' ? 'active' : ''} aria-pressed={kind === 'subscription'} onClick={() => setKind('subscription')}>订阅</button><button type="button" className={kind === 'direct' ? 'active' : ''} aria-pressed={kind === 'direct'} onClick={() => setKind('direct')}>直连</button></div><small className="field-hint">{kind === 'subscription' ? '显示周期额度、窗口额度和会员信息。' : '显示余额或服务商提供的账户额度。'}</small></div>
      <div className="field"><span>接口协议</span><div className="api-endpoint-editor">{endpoints.map((endpoint, index) => <div className="api-endpoint-row" key={index}><select value={endpoint.protocol} onChange={(e) => updateEndpoint(index, { protocol: e.target.value as ApiProtocol })}>{(Object.keys(protocolLabels) as ApiProtocol[]).map((protocol) => <option key={protocol} value={protocol}>{protocolLabels[protocol]}</option>)}</select><input value={endpoint.url} onChange={(e) => updateEndpoint(index, { url: e.target.value })} placeholder={protocolDefaults[endpoint.protocol]} /><select value={endpoint.auth} aria-label={`${protocolLabels[endpoint.protocol]} 认证`} onChange={(e) => updateEndpoint(index, { auth: e.target.value as ApiEndpoint['auth'] })}><option value="bearer">Bearer</option><option value="x_api_key">X-API-Key</option><option value="none">无认证</option></select>{endpoints.length > 1 && <button type="button" className="icon-btn" aria-label={`移除${protocolLabels[endpoint.protocol]}协议`} onClick={() => setEndpoints((old) => old.filter((_, i) => i !== index))}><Icon name="close" size={14} /></button>}</div>)}</div><button type="button" className="text-btn" onClick={() => setEndpoints((old) => [...old, makeEndpoint('anthropic')])}><Icon name="plus" size={13} />添加协议地址</button></div>
      <label className="field"><span>API Key</span><div className="input-with-btn"><input type={showKey ? 'text' : 'password'} autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} placeholder={original ? '点击显示读取当前 Key，或留空保留' : '输入 API Key'} /><button type="button" className="btn btn-ghost" disabled={keyLoading} onClick={() => void revealKey()}>{keyLoading ? '读取中…' : showKey ? '隐藏' : '显示'}</button></div></label>
      <label className="field"><span>控制台地址</span><input value={consoleUrl} onChange={(e) => setConsoleUrl(e.target.value)} placeholder="可选，例如 https://…/console" /></label>
      <div className="field"><span>额度适配器</span><select value={quota.profile} onChange={(e) => setQuota((old) => ({ ...old, profile: e.target.value }))}>{profiles.filter((item) => item.kind === 'none' || item.kind === 'custom' || (kind === 'subscription' ? item.kind !== 'balance' : item.kind !== 'subscription')).map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select><small className="field-hint">{profiles.find((item) => item.id === quota.profile)?.description || '适配器使用此账号已配置的地址和 Key。'}</small></div>
      {profiles.find((item) => item.id === quota.profile)?.kind === 'custom' && <div className="api-quota-fields"><label className="field"><span>展示组件</span><select aria-label="展示组件" value={quota.presentation ?? 'balance'} onChange={(e) => setQuota((old) => ({ ...old, presentation: e.target.value as 'balance' | 'quota' }))}><option value="balance">账户余额</option><option value="quota">周期额度</option></select></label><label className="field"><span>认证方式</span><select aria-label="额度认证方式" value={quota.auth} onChange={(e) => setQuota((old) => ({ ...old, auth: e.target.value as ApiQuotaSettings['auth'] }))}><option value="bearer">Bearer</option><option value="x_api_key">X-API-Key</option><option value="none">无认证</option></select></label><input value={quota.path} onChange={(e) => setQuota((old) => ({ ...old, path: e.target.value }))} placeholder="查询路径，例如 /dashboard/billing" /><input value={quota.balance_pointer} onChange={(e) => setQuota((old) => ({ ...old, balance_pointer: e.target.value }))} placeholder="余额 JSON Pointer，例如 /data/balance" /><input value={quota.used_pointer} onChange={(e) => setQuota((old) => ({ ...old, used_pointer: e.target.value }))} placeholder="已用 JSON Pointer（可选）" /><input value={quota.limit_pointer} onChange={(e) => setQuota((old) => ({ ...old, limit_pointer: e.target.value }))} placeholder="总量 JSON Pointer（可选）" /><input value={quota.remaining_pointer} onChange={(e) => setQuota((old) => ({ ...old, remaining_pointer: e.target.value }))} placeholder="剩余 JSON Pointer（可选）" /><input value={quota.reset_pointer} onChange={(e) => setQuota((old) => ({ ...old, reset_pointer: e.target.value }))} placeholder="重置时间 JSON Pointer（可选）" /><input value={quota.unit} onChange={(e) => setQuota((old) => ({ ...old, unit: e.target.value }))} placeholder="单位（可选）" /></div>}    </fieldset>
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="modal-actions api-modal-actions">{onDelete && (confirmDelete ? <span className="delete-confirm"><span>确认删除此账号？</span><button className="text-btn danger" disabled={saving} onClick={() => void onDelete()}>确认删除</button></span> : <button className="text-btn danger modal-delete" disabled={saving} onClick={() => setConfirmDelete(true)}>删除账号</button>)}<span className="modal-actions-spacer" /><button className="btn btn-ghost" disabled={saving} onClick={onClose}>取消</button><button className="btn btn-primary" disabled={saving || !name.trim() || !endpoints.some((e) => e.url.trim()) || (!original && !key.trim())} onClick={() => void save()}>{saving ? '保存中…' : '保存'}</button></div>
  </ModalShell>
}

function statusOf(account: ApiAccount, result?: ApiProbeResult, refreshing?: boolean, error?: string) { if (!account.configured) return 'unconfigured'; if (refreshing) return 'pending'; if (error) return 'error'; const status = result?.model_sets[0]?.result.status; return status === 'ok' || status === 'partial' ? 'ok' : status === 'error' ? 'error' : 'idle' }

export default function ApiPanel({ visible, pushToast }: { visible: boolean; pushToast: (kind: 'success' | 'error', text: string) => void }) {
  const [accounts, setAccounts] = useState<ApiAccount[]>([])
  const [profiles, setProfiles] = useState<ApiProbeProfile[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [results, setResults] = useState<Record<string, ApiProbeResult>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [refreshing, setRefreshing] = useState<Record<string, boolean>>({})
  const [checks, setChecks] = useState<Record<string, ProbeResult>>({})
  const [checkingKey, setCheckingKey] = useState<string | null>(null)
  const [protocol, setProtocol] = useState<ApiProtocol>('openai')
  const [accountSearch, setAccountSearch] = useState('')
  const [modelSearch, setModelSearch] = useState('')
  const [editing, setEditing] = useState<ApiAccount | null | undefined>(undefined)
  const opening = useRef(false)
  const selected = accounts.find((account) => account.id === selectedId) ?? null
  const result = selected ? results[selected.id] : undefined
  const filteredAccounts = useMemo(() => accounts.filter((account) => `${account.name} ${account.url}`.toLowerCase().includes(accountSearch.toLowerCase())), [accounts, accountSearch])
  const activeSet = result?.model_sets.find((set) => set.protocol === protocol)?.result
  const models = activeSet?.models ?? []
  const shownModels = models.filter((item) => `${item.id} ${item.name ?? ''}`.toLowerCase().includes(modelSearch.toLowerCase()))
  const selectedProtocols = selected?.endpoints.map((endpoint) => endpoint.protocol) ?? []
  const selectedProfile = profiles.find((profile) => profile.id === selected?.quota.profile)

  const refreshAccount = async (account: ApiAccount) => {
    if (!account.configured) { setErrors((old) => ({ ...old, [account.id]: '请先设置 API Key。' })); return }
    setRefreshing((old) => ({ ...old, [account.id]: true })); setErrors((old) => ({ ...old, [account.id]: '' }))
    try { const [rawProbe, profileList] = await Promise.all([api.probeApiAccount(account.id), api.getApiProbeProfiles()]); const next = normalizeProbe(rawProbe); setProfiles(profileList); setResults((old) => ({ ...old, [account.id]: next })); setChecks((old) => Object.fromEntries(Object.entries(old).filter(([key]) => !key.startsWith(`${account.id}:`)))) } catch (e) { setErrors((old) => ({ ...old, [account.id]: String(e) })) } finally { setRefreshing((old) => ({ ...old, [account.id]: false })) }
  }
  const refreshAll = async (list = accounts) => { await Promise.all(list.filter((account) => account.configured).map((account) => refreshAccount(account))) }
  const load = async (autoRefresh: boolean) => { try { const [profileList, rawAccounts] = await Promise.all([api.getApiProbeProfiles(), api.getApiAccounts()]); setProfiles(profileList); const next = rawAccounts.map((account) => normalizeAccount(account)); setAccounts(next); const current = next.find((account) => account.id === selectedId) ?? next[0] ?? null; setSelectedId(current?.id ?? null); if (autoRefresh) void refreshAll(next) } catch (e) { pushToast('error', String(e)) } }
  useEffect(() => { if (visible && !opening.current) { opening.current = true; void load(true) } else if (!visible) opening.current = false }, [visible])
  const saveAccount = async (original: string | null, name: string, kind: 'subscription' | 'direct', endpoints: ApiEndpoint[], quota: ApiQuotaSettings, key: string, consoleUrl: string) => { const next = (await api.saveApiAccount(original, name, kind, endpoints, quota, key, consoleUrl)).map((account) => normalizeAccount(account)); setAccounts(next); setProfiles(await api.getApiProbeProfiles().catch(() => profiles)); const saved = next.find((item) => item.name === name.trim()); if (saved) { setSelectedId(saved.id); setResults((old) => { const copy = { ...old }; if (original) delete copy[`api:${original}`]; delete copy[saved.id]; return copy }); void refreshAccount(saved) } pushToast('success', `已保存 API「${name.trim()}」`) }
  const remove = async (account: ApiAccount) => { const next = (await api.deleteApiAccount(account.name)).map((item) => normalizeAccount(item)); setAccounts(next); setResults((old) => { const copy = { ...old }; delete copy[account.id]; return copy }); setSelectedId(next[0]?.id ?? null); setEditing(undefined); pushToast('success', `已移除「${account.name}」`) }
  const checkModel = async (model: string) => { if (!selected || checkingKey) return; const key = `${selected.id}:${protocol}:${model}`; setCheckingKey(key); try { const checked = await api.checkApiModel(selected.id, model, protocol); setChecks((old) => ({ ...old, [key]: checked })) } catch (e) { setChecks((old) => ({ ...old, [key]: { status: 'error', message: String(e), checked_at: Date.now(), latency_ms: 0, http_status: null, models: [], quota: null } })) } finally { setCheckingKey(null) } }
  const modelCheckKey = (model: string) => selected ? `${selected.id}:${protocol}:${model}` : ''
  const selectedBusy = selected ? !!refreshing[selected.id] : false
  const allBusy = Object.values(refreshing).some(Boolean)
  const reorder = (names: string[]) => { void api.reorderApiAccounts(names).then((next) => setAccounts(next.map((item) => normalizeAccount(item)))).catch((e) => pushToast('error', String(e))) }
  const openConsole = (url: string) => { void api.openExternalUrl(url).catch((error) => pushToast('error', `无法打开控制台：${String(error)}`)) }
  const revealApiKey = (id: string) => api.getApiAccountKey(id)

  return <section className="api-panel">
    <div className="api-workspace">
      <aside className="api-accounts"><div className="api-list-head"><strong>账户 <span className="count">{accounts.length}</span></strong><div className="api-list-head-actions"><button className="icon-btn" aria-label="添加 API" title="添加 API" onClick={() => setEditing(null)}><Icon name="plus" size={16} /></button><button className="icon-btn" aria-label="刷新全部账号" title="刷新全部账号" disabled={allBusy} onClick={() => void refreshAll()}><Icon name="refresh" size={15} /></button></div></div>
        <label className="search-box"><Icon name="search" size={15} /><input aria-label="搜索 API" value={accountSearch} onChange={(e) => setAccountSearch(e.target.value)} placeholder="搜索名称或地址" /></label>
        <div className="api-list"><SortableList items={filteredAccounts} className="api-list-sortable" disabled={!!accountSearch} onReorder={reorder} render={(account) => {
          const status = statusOf(account, results[account.id], refreshing[account.id], errors[account.id])
          const label = status === 'ok' ? '可用' : status === 'error' ? '异常' : status === 'pending' ? '刷新中' : status === 'unconfigured' ? '未配置' : '待刷新'
          const select = () => { setSelectedId(account.id); setProtocol(account.endpoints[0]?.protocol ?? 'openai'); setModelSearch('') }
          return <div data-drag-surface key={account.id} style={{ '--provider-color': account.color } as CSSProperties} className={`api-account${selectedId === account.id ? ' active' : ''}`} role="button" tabIndex={0} aria-pressed={selectedId === account.id} onClick={select} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select() } }}><span className="api-avatar">{account.name.slice(0, 1).toUpperCase()}</span><span className="api-account-copy"><strong>{account.name}</strong><small><span className="api-kind-tag">{account.kind === 'subscription' ? 'S' : '↗'}</span> {account.endpoints.map((endpoint) => protocolLabels[endpoint.protocol]).join(' · ')}</small></span><span className={`api-account-dot ${status}`} role="img" aria-label={label} title={label} /></div>
        } } /></div>
      </aside>
      <main className="api-detail">{!selected ? <div className="api-empty"><div className="kimi-monogram">A</div><h3>建立你的 API 清单</h3><p>集中查看各个服务的额度、模型与可用性。</p><button className="btn btn-primary" onClick={() => setEditing(null)}>添加 API<Icon name="arrow" size={15} /></button></div> : <>
        <div className="api-detail-head"><div><span className="eyebrow">API PROBE · {selected.kind === 'subscription' ? '订阅' : '直连'}</span><h3>{selected.name}</h3><span className="mono dim">{selected.key_masked || '尚未配置 API Key'}</span></div><div className="api-detail-actions">{selected.console_url && <button className="icon-btn" aria-label="打开控制台" title="打开控制台" onClick={() => openConsole(selected.console_url)}><Icon name="external" size={16} /></button>}<button className="btn btn-primary" disabled={selectedBusy} onClick={() => void refreshAccount(selected)}><Icon name="refresh" size={15} />{selectedBusy ? '刷新中…' : '刷新'}</button><button className="icon-btn" aria-label="编辑账号" title="编辑账号" onClick={() => setEditing(selected)}><Icon name="more" size={17} /></button></div></div>
        {(errors[selected.id] || result?.model_sets[0]?.result.status === 'error') && <div className="inline-error" role="alert"><span>{errors[selected.id] || result?.model_sets[0]?.result.message}</span><button className="text-btn" disabled={selectedBusy} onClick={() => void refreshAccount(selected)}>重试</button></div>}
        <QuotaPanel profile={selectedProfile} result={result?.quota} color={selected.color} loading={selectedBusy} />

        <section className="api-models"><div className="api-section-head api-model-head"><div><span className="eyebrow">MODEL DISCOVERY</span><h4>可用模型 <span className="count">{models.length}</span></h4></div><div className="api-model-tools"><div className="protocol-pills" role="group" aria-label="模型接口协议">{selectedProtocols.map((item) => <button key={item} className={protocol === item ? 'active' : ''} aria-pressed={protocol === item} onClick={() => setProtocol(item)}>{protocolLabels[item]}</button>)}</div><label className="search-box"><Icon name="search" size={14} /><input aria-label="过滤模型" value={modelSearch} onChange={(e) => setModelSearch(e.target.value)} placeholder="过滤模型" /></label></div></div>
          <p className="model-check-hint">选择接口协议后，点击模型名称检查可用性。</p><div className="api-model-list">{shownModels.map((item) => { const key = modelCheckKey(item.id); const checked = checks[key]; const status = checkingKey === key ? 'pending' : checked?.status ?? 'idle'; return <button type="button" className={`api-model-row ${status}`} key={item.id} title={checked?.message ?? `检查 ${item.id} · ${protocolLabels[protocol]}`} onClick={() => void checkModel(item.id)} disabled={!!checkingKey}><span className={`model-dot ${status}`} /><strong>{item.id}</strong>{item.name && <small>{item.name}</small>}{checked && <span className="model-latency">{checked.latency_ms} ms</span>}</button> })}{!shownModels.length && <div className="empty"><strong>{models.length ? '没有匹配的模型' : result ? '没有返回模型' : selectedBusy ? '正在读取模型列表…' : selected.configured ? '等待模型刷新' : '尚未配置 API Key'}</strong><span>{models.length ? '调整过滤词试试。' : activeSet?.message ?? '点击刷新获取模型。'}</span></div>}</div>
        </section>
      </>}</main>
    </div>
    {editing !== undefined && <ApiAccountModal original={editing} profiles={profiles} onClose={() => setEditing(undefined)} onSave={saveAccount} onDelete={editing ? () => remove(editing) : undefined} onRevealKey={revealApiKey} />}
  </section>
}
