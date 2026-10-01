import type { ReactNode } from 'react'
import type { Provider, ProviderResults, ProbeTask } from '../types'
import ProviderInspection from './ProviderInspection'

interface Props {
  provider: Provider
  selected: boolean
  checked: boolean
  busy: boolean
  handle: ReactNode
  results?: ProviderResults
  onCheck: () => void
  onSelect: () => void
  onEdit: () => void
  onDelete: () => void
  onSettings: () => void
  onRun: (task: ProbeTask) => void
}

export default function ProviderCard({ provider, selected, checked, busy, handle, results, onCheck, onSelect, onEdit, onDelete, onSettings, onRun }: Props) {
  return (
    <div
      className={`card provider-card${selected ? ' selected' : ''}`}
      onClick={onSelect}
    >
      <div className="card-head">
        <span onClick={(e) => e.stopPropagation()}>{handle}</span>
        <label className="batch-checkbox" onClick={(e) => e.stopPropagation()} title="勾选用于批量查询">
          <input type="checkbox" aria-label={`批量选择 ${provider.name}`} checked={checked} disabled={busy} onChange={onCheck} />
        </label>
        <button className="provider-name" aria-pressed={selected} onClick={(e) => { e.stopPropagation(); onSelect() }}>{provider.name}</button>
        {selected && <span className="tag tag-accent">待应用</span>}
      </div>
      <div className="card-row mono" title={provider.url}>
        {provider.url}
      </div>
      <div className="card-row mono dim">{provider.key_masked}</div>
      <div className="card-actions" onClick={(e) => e.stopPropagation()}>
        <button className="btn btn-ghost" disabled={busy} onClick={onEdit}>
          编辑
        </button>
        <button className="btn btn-ghost" disabled={busy} onClick={onSettings}>查询设置</button>
        <button className="btn btn-danger" disabled={busy} onClick={onDelete}>
          删除
        </button>
      </div>
      <ProviderInspection results={results} busy={busy} configuredQuota={provider.inspection.quota.adapter !== 'none'} onRun={onRun} onSettings={onSettings} />
    </div>
  )
}
