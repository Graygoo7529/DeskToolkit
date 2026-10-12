import { useState } from 'react'
import type { Auth, InspectionInput, Provider, ApiProbeProfile } from '../types'
import { ModalShell } from './Modals'
import QuotaSettingsEditor, { quotaInput } from './QuotaSettingsEditor'

function AuthSelect({ value, onChange }: { value: Auth; onChange: (v: Auth) => void }) {
  return <select value={value} onChange={(e) => onChange(e.target.value as Auth)}>
    <option value="bearer">Bearer Token（使用此 Provider 的 Key）</option>
    <option value="x_api_key">x-api-key（使用此 Provider 的 Key）</option>
    <option value="none">不发送认证</option>
  </select>
}

export default function InspectionModal({ provider, profiles, profilesError, onReloadProfiles, onClose, onSave }: {
  provider: Provider
  profiles: ApiProbeProfile[]
  profilesError: string
  onReloadProfiles: () => void
  onClose: () => void
  onSave: (settings: InspectionInput) => Promise<void>
}) {
  const [settings, setSettings] = useState<InspectionInput>(() => ({ ...provider.inspection, quota: quotaInput(provider.inspection.quota) }))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
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
      <h4>额度 / 余额</h4>
      {profilesError && <div className="inline-error" role="alert">{profilesError} <button type="button" className="text-btn" onClick={onReloadProfiles}>重新加载</button></div>}
      <QuotaSettingsEditor value={settings.quota} profiles={profiles} onChange={(quota) => setSettings((old) => ({ ...old, quota }))} />
    </fieldset>
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="modal-actions"><button className="btn btn-ghost" disabled={saving} onClick={onClose}>取消</button>
      <button className="btn btn-primary" disabled={saving || !profiles.some((profile) => profile.id === settings.quota.profile)} onClick={save}>{saving ? '保存中…' : '保存查询设置'}</button></div>
  </ModalShell>
}
