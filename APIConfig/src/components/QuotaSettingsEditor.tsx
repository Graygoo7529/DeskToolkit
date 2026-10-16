import { useState } from 'react'
import type { ApiProbeProfile, QuotaInput, QuotaSettings } from '../types'
import Icon from './Icon'
import QuotaProfileWizard from './QuotaProfileWizard'

export const quotaInput = (settings?: QuotaSettings): QuotaInput => ({
  profile: settings?.profile || 'none', presentation: 'balance', path: '', auth_mode: 'auto',
  balance_pointer: '', used_pointer: '', limit_pointer: '', remaining_pointer: '', reset_pointer: '', unit: '',
})

export default function QuotaSettingsEditor({ value, profiles, kind, onChange, onProfileCreated }: {
  value: QuotaInput
  profiles: ApiProbeProfile[]
  kind?: 'subscription' | 'direct'
  onChange: (value: QuotaInput) => void
  onProfileCreated?: (profile: ApiProbeProfile) => void
}) {
  const [wizardOpen, setWizardOpen] = useState(false)
  const [createdProfiles, setCreatedProfiles] = useState<ApiProbeProfile[]>([])
  const selected = profiles.find((profile) => profile.id === value.profile)
    ?? createdProfiles.find((profile) => profile.id === value.profile)
  const update = (patch: Partial<QuotaInput>) => onChange({ ...value, ...patch })
  const available = [...profiles, ...createdProfiles.filter((profile) => !profiles.some((item) => item.id === profile.id))]
    .filter((profile) => !kind || profile.id === value.profile || profile.kind === 'none' || profile.kind === (kind === 'direct' ? 'balance' : 'subscription'))
  return <>
    <div className="field quota-profile-select"><span>额度查询方案</span><div className="input-with-btn"><select value={value.profile} disabled={!available.length} onChange={(e) => update({ profile: e.target.value })}>
        {!selected && <option value={value.profile}>{available.length ? '方案未找到，请重新选择' : '加载查询方案…'}</option>}
        {available.map((profile) => <option key={profile.id} value={profile.id}>{profile.label}</option>)}
      </select><button type="button" className="icon-btn" aria-label="新建额度方案" title="新建额度方案" onClick={() => setWizardOpen(true)}><Icon name="plus" size={15} /></button></div>
      <small className="field-hint">{selected?.description || '使用当前账号的 Base URL 和 Key，查询方案与 API Probe 共用。'}</small>
    </div>
    {wizardOpen && <QuotaProfileWizard kind={kind === 'subscription' ? 'subscription' : 'balance'} onClose={() => setWizardOpen(false)} onCreated={(profile) => { setCreatedProfiles((old) => [...old.filter((item) => item.id !== profile.id), profile]); update({ profile: profile.id }); setWizardOpen(false); onProfileCreated?.(profile) }} />}
  </>
}
