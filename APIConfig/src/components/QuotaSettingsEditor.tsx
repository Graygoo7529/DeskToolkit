import type { ApiProbeProfile, QuotaInput, QuotaSettings } from '../types'

export const quotaInput = (settings?: QuotaSettings): QuotaInput => ({
  profile: settings?.profile || 'none', presentation: 'balance', path: '', auth: 'bearer',
  balance_pointer: '', used_pointer: '', limit_pointer: '', remaining_pointer: '', reset_pointer: '', unit: '',
})

export default function QuotaSettingsEditor({ value, profiles, kind, onChange }: {
  value: QuotaInput
  profiles: ApiProbeProfile[]
  kind?: 'subscription' | 'direct'
  onChange: (value: QuotaInput) => void
}) {
  const selected = profiles.find((profile) => profile.id === value.profile)
  const update = (patch: Partial<QuotaInput>) => onChange({ ...value, ...patch })
  const available = profiles.filter((profile) => !kind || profile.id === value.profile || profile.kind === 'none' || profile.kind === 'custom' || profile.kind === (kind === 'direct' ? 'balance' : 'subscription'))
  return <>
    <label className="field"><span>额度适配器</span>
      <select value={value.profile} disabled={!profiles.length} onChange={(e) => update({ profile: e.target.value })}>
        {!selected && <option value={value.profile}>{profiles.length ? '方案未找到，请重新选择' : '加载查询方案…'}</option>}
        {available.map((profile) => <option key={profile.id} value={profile.id}>{profile.label}</option>)}
      </select>
      <small className="field-hint">{selected?.description || '使用当前账号的 Base URL 和 Key，查询方案与 API Probe 共用。'}</small>
    </label>
    {selected?.kind === 'custom' && <div className="api-quota-fields">
      <label className="field"><span>展示组件</span><select value={value.presentation} onChange={(e) => update({ presentation: e.target.value as 'balance' | 'quota' })}>
        <option value="balance">账户余额</option><option value="quota">周期额度</option>
      </select></label>
      <label className="field"><span>额度认证方式</span><select value={value.auth} onChange={(e) => update({ auth: e.target.value as QuotaInput['auth'] })}>
        <option value="bearer">Bearer</option><option value="x_api_key">X-API-Key</option><option value="none">无认证</option>
      </select></label>
      <input aria-label="额度接口路径" value={value.path} onChange={(e) => update({ path: e.target.value })} placeholder="查询路径，例如 /dashboard/billing" />
      {value.presentation === 'balance'
        ? <input aria-label="余额字段" value={value.balance_pointer} onChange={(e) => update({ balance_pointer: e.target.value })} placeholder="余额 JSON Pointer，例如 /data/balance" />
        : (['used_pointer', 'limit_pointer', 'remaining_pointer', 'reset_pointer'] as const).map((field, index) => <input key={field}
          aria-label={['已用字段', '总量字段', '剩余字段', '重置时间字段'][index]} value={value[field]}
          onChange={(e) => update({ [field]: e.target.value })} placeholder={['已用 JSON Pointer（可选）', '总量 JSON Pointer（可选）', '剩余 JSON Pointer（可选）', '重置时间 JSON Pointer（可选）'][index]} />)}
      <input aria-label="额度单位" value={value.unit} onChange={(e) => update({ unit: e.target.value })} placeholder="单位（可选）" />
      <small className="field-hint">保存后生成独立 TOML 方案，三个页面都可选用。路径以 / 开头时从域名根目录查询。</small>
    </div>}
  </>
}
