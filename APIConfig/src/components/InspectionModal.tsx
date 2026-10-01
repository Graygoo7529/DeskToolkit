import { useState } from 'react'
import type { Auth, InspectionSettings, Provider } from '../types'
import { ModalShell } from './Modals'

function AuthSelect({ value, onChange }: { value: Auth; onChange: (v: Auth) => void }) {
  return <select value={value} onChange={(e) => onChange(e.target.value as Auth)}>
    <option value="bearer">Bearer Token（使用此 Provider 的 Key）</option>
    <option value="x_api_key">x-api-key（使用此 Provider 的 Key）</option>
    <option value="none">不发送认证</option>
  </select>
}

export default function InspectionModal({ provider, onClose, onSave }: {
  provider: Provider
  onClose: () => void
  onSave: (settings: InspectionSettings) => Promise<void>
}) {
  const [settings, setSettings] = useState<InspectionSettings>(() => structuredClone(provider.inspection))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const q = settings.quota
  const quota = (update: Partial<InspectionSettings['quota']>) => setSettings((s) => ({ ...s, quota: { ...s.quota, ...update } }))
  const save = async () => {
    setSaving(true); setError('')
    try { await onSave(settings); onClose() } catch (e) { setError(String(e)) } finally { setSaving(false) }
  }
  return <ModalShell title={`查询设置 · ${provider.name}`} onClose={() => !saving && onClose()}>
    <fieldset disabled={saving}>
      <h4>连接与模型</h4>
      <label className="field"><span>模型接口路径（可选）</span>
        <input value={settings.models_path} onChange={(e) => setSettings({ ...settings, models_path: e.target.value })} placeholder="自动：Base URL + /v1/models（不重复 v1）" />
        <small className="field-hint">连接测试也读取此接口，不发起模型生成。</small>
      </label>
      <label className="field"><span>认证方式</span><AuthSelect value={settings.models_auth} onChange={(models_auth) => setSettings({ ...settings, models_auth })} /></label>
      <h4>额度查询</h4>
      <label className="field"><span>额度适配器</span>
        <select value={q.adapter} onChange={(e) => quota({ adapter: e.target.value as typeof q.adapter })}>
          <option value="none">未配置（批量查询自动跳过）</option>
          <option value="kimi">Kimi Code · 周额度 / 5 小时窗口</option>
          <option value="custom">自定义 · 余额 / 使用量</option>
        </select>
      </label>
      {q.adapter !== 'none' && <>
        <label className="field"><span>额度接口路径 {q.adapter === 'kimi' ? '（可选）' : '（必填）'}</span>
          <input value={q.path} onChange={(e) => quota({ path: e.target.value })} placeholder={q.adapter === 'kimi' ? '自动：Base URL + /v1/usages' : '例如 /api/user/balance'} />
          <small className="field-hint">以 / 开头从域名根目录查询，否则相对于 Base URL。只允许同源地址，使用 GET。</small>
        </label>
        <label className="field"><span>额度接口认证</span><AuthSelect value={q.auth} onChange={(auth) => quota({ auth })} /></label>
        <label className="field"><span>单位（可选）</span><input value={q.unit} onChange={(e) => quota({ unit: e.target.value })} placeholder="例如 USD、CNY、次" /></label>
        {q.adapter === 'kimi' ? <p className="hint">用于 Kimi Code 订阅额度；需使用 Kimi Code 的服务地址与密钥。</p> : <>
          <p className="hint">填写需要显示的字段，至少一个数值字段。使用 JSON Pointer，例如 /data/balance；缺失值显示 —。</p>
          <div className="field-grid">
            {([
              ['balance_pointer', '余额', '/data/balance'], ['used_pointer', '已用', '/data/used'],
              ['limit_pointer', '总额度', '/data/limit'], ['remaining_pointer', '剩余', '/data/remaining'],
              ['reset_pointer', '重置时间（ISO 字符串）', '/data/reset_at'],
            ] as const).map(([key, label, placeholder]) => <label className="field" key={key}><span>{label}</span>
              <input value={q[key]} onChange={(e) => quota({ [key]: e.target.value })} placeholder={placeholder} />
            </label>)}
          </div>
        </>}
      </>}
    </fieldset>
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="modal-actions"><button className="btn btn-ghost" disabled={saving} onClick={onClose}>取消</button>
      <button className="btn btn-primary" disabled={saving} onClick={save}>{saving ? '保存中…' : '保存查询设置'}</button></div>
  </ModalShell>
}
