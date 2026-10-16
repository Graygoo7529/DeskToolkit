import { useState } from 'react'
import { createPortal } from 'react-dom'
import * as api from '../api'
import type { ApiProbeProfile } from '../types'
import { ModalShell } from './Modals'

type Kind = 'balance' | 'subscription'
type WindowDraft = api.QuotaProfileWindow

const emptyWindow = (index: number): WindowDraft => ({ id: index ? `window_${index + 1}` : 'daily', label: index ? `额度窗口 ${index + 1}` : '日额度', required: true, used_pointer: '', limit_pointer: '', remaining_pointer: '', reset_pointer: '' })

export default function QuotaProfileWizard({ kind: initialKind, onClose, onCreated }: { kind: Kind; onClose: () => void; onCreated: (profile: ApiProbeProfile) => void }) {
  const [step, setStep] = useState(0)
  const [kind, setKind] = useState<Kind>(initialKind)
  const [label, setLabel] = useState('')
  const [layoutLabel, setLayoutLabel] = useState('额度')
  const [method, setMethod] = useState<'GET' | 'POST'>('GET')
  const [path, setPath] = useState('')
  const [auth_mode, setAuthMode] = useState<'auto' | 'none'>('auto')
  const [body, setBody] = useState('')
  const [balance, setBalance] = useState('')
  const [unit, setUnit] = useState('')
  const [membership, setMembership] = useState('')
  const [windows, setWindows] = useState<WindowDraft[]>([emptyWindow(0)])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const updateWindow = (index: number, patch: Partial<WindowDraft>) => setWindows((old) => old.map((item, i) => i === index ? { ...item, ...patch } : item))
  const save = async () => {
    setSaving(true); setError('')
    try {
      const blocks: api.QuotaProfileBlock[] = kind === 'balance'
        ? [{ component: 'balance_card', source: 'balance', title: '账户余额' }]
        : windows.map((item) => ({ component: 'quota_card' as const, source: `windows.${item.id}`, title: item.label || item.id }))
      const profile = await api.createQuotaProfile({ label: label.trim(), kind, layout_label: layoutLabel.trim() || '额度', request_method: method, request_path: path.trim(), request_auth_mode: auth_mode, request_body: body.trim(), balance_pointer: kind === 'balance' ? balance.trim() : '', default_unit: unit.trim(), membership_pointer: membership.trim(), blocks, windows: kind === 'subscription' ? windows : [] })
      onCreated(profile)
    } catch (e) { setError(String(e)) } finally { setSaving(false) }
  }
  return createPortal(<ModalShell title="新建额度查询方案" onClose={() => !saving && onClose()}>
    <div className="wizard-steps"><span className={step === 0 ? 'active' : ''}>1 展示面板</span><span className={step === 1 ? 'active' : ''}>2 查询接口</span><span className={step === 2 ? 'active' : ''}>3 字段映射</span></div>
    <fieldset disabled={saving}>
      {step === 0 && <>
        <label className="field"><span>方案名称</span><input autoFocus value={label} onChange={(e) => setLabel(e.target.value)} placeholder="例如 我的服务日额度" /></label>
        <label className="field"><span>展示类型</span><div className="segmented-control"><button type="button" className={kind === 'balance' ? 'active' : ''} onClick={() => setKind('balance')}>账户余额</button><button type="button" className={kind === 'subscription' ? 'active' : ''} onClick={() => setKind('subscription')}>周期额度</button></div></label>
        <label className="field"><span>面板标题</span><input value={layoutLabel} onChange={(e) => setLayoutLabel(e.target.value)} placeholder="例如 额度" /></label>
        {kind === 'subscription' && <div className="wizard-window-list"><div className="quota-preview"><span className="eyebrow">实时预览</span>{windows.map((item) => <span className="quota-preview-card" key={item.id}>{item.label || item.id}<strong>—</strong></span>)}</div>{windows.map((item, index) => <div className="wizard-window" key={item.id}><input aria-label={`窗口 ${index + 1} 名称`} value={item.label} onChange={(e) => updateWindow(index, { label: e.target.value })} placeholder="窗口名称" /><input aria-label={`窗口 ${index + 1} ID`} value={item.id} onChange={(e) => updateWindow(index, { id: e.target.value })} placeholder="窗口 ID（建议 hourly/daily/weekly/monthly）" />{windows.length > 1 && <button type="button" className="text-btn danger" onClick={() => setWindows((old) => old.filter((_, i) => i !== index))}>移除</button>}</div>)}<button type="button" className="text-btn" onClick={() => setWindows((old) => [...old, emptyWindow(old.length)])}>+ 添加额度窗口</button></div>}
        {kind === 'balance' && <div className="quota-preview"><span className="eyebrow">实时预览</span><span className="quota-preview-card">账户余额<strong>—</strong></span></div>}
      </>}
      {step === 1 && <>
        <label className="field"><span>请求方法</span><select value={method} onChange={(e) => setMethod(e.target.value as 'GET' | 'POST')}><option>GET</option><option>POST</option></select></label>
        <label className="field"><span>查询路径</span><input autoFocus value={path} onChange={(e) => setPath(e.target.value)} placeholder="例如 /v1/usage" /></label>
        <label className="field"><span>认证方式</span><select value={auth_mode} onChange={(e) => setAuthMode(e.target.value as typeof auth_mode)}><option value="auto">自动（Bearer）</option><option value="none">无认证</option></select></label>
        {method === 'POST' && <label className="field"><span>POST JSON Body（可选）</span><textarea aria-label="POST JSON Body" value={body} onChange={(e) => setBody(e.target.value)} placeholder='例如 {"scope":"account"}' rows={4} /></label>}
        <p className="hint">路径相对于账号的第一个接口地址，查询时使用账号已有的 API Key。</p>
      </>}
      {step === 2 && <>
        {kind === 'balance' ? <><label className="field"><span>余额字段路径</span><input autoFocus value={balance} onChange={(e) => setBalance(e.target.value)} placeholder="JSON Pointer，例如 /data/balance" /></label></> : windows.map((item, index) => <div className="wizard-mapping" key={item.id}><strong>{item.label || item.id}</strong><input aria-label={`${item.label || item.id} 已用字段`} value={item.used_pointer} onChange={(e) => updateWindow(index, { used_pointer: e.target.value })} placeholder="已用字段（可选）" /><input aria-label={`${item.label || item.id} 总量字段`} value={item.limit_pointer} onChange={(e) => updateWindow(index, { limit_pointer: e.target.value })} placeholder="总量字段（可选）" /><input aria-label={`${item.label || item.id} 剩余字段`} value={item.remaining_pointer} onChange={(e) => updateWindow(index, { remaining_pointer: e.target.value })} placeholder="剩余字段（可选）" /><input aria-label={`${item.label || item.id} 重置字段`} value={item.reset_pointer} onChange={(e) => updateWindow(index, { reset_pointer: e.target.value })} placeholder="重置时间字段（可选）" /></div>)}
        <label className="field"><span>单位</span><input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="例如 USD、CNY、%" /></label>
        <label className="field"><span>套餐字段（可选，有值自动显示）</span><input value={membership} onChange={(e) => setMembership(e.target.value)} placeholder="JSON Pointer，例如 /planName" /></label>
        <p className="hint">JSON Pointer 以 / 开头；已用、总量、剩余三项中填写任意两项即可自动推算第三项。</p>
      </>}
    </fieldset>
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="modal-actions"><button className="btn btn-ghost" disabled={saving} onClick={step ? () => setStep(step - 1) : onClose}>{step ? '上一步' : '取消'}</button>{step < 2 ? <button className="btn btn-primary" disabled={saving || (step === 0 && (!label.trim() || (kind === 'subscription' && !windows.length)))} onClick={() => setStep(step + 1)}>下一步</button> : <button className="btn btn-primary" disabled={saving || !path.trim() || (kind === 'balance' ? !balance.trim() : windows.some((item) => !item.used_pointer.trim() && !item.limit_pointer.trim() && !item.remaining_pointer.trim()))} onClick={() => void save()}>{saving ? '生成中…' : '生成并使用'}</button>}</div>
  </ModalShell>, document.body)
}
