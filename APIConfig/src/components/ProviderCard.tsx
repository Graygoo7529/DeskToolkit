import type { Provider, ProviderResults } from '../types'
import Icon from './Icon'
import { providerStyle } from '../providerColor'

interface Props {
  provider: Provider; selected: boolean; results?: ProviderResults; appliedCount: number
  onSelect: () => void; onDetails: () => void
}

export default function ProviderCard({ provider, selected, results, appliedCount, onSelect, onDetails }: Props) {
  const connection = results?.connection
  const status = connection?.pending ? 'pending' : connection?.result?.status ?? 'idle'
  const label = { idle: '尚未检查', pending: '正在检查连接', ok: '连接可用', partial: '连接部分可用', error: '连接异常', skipped: '未检查' }[status]
  let host = provider.url
  try { host = new URL(provider.url).host } catch { /* 保留原地址 */ }
  return <article style={providerStyle(provider)} className={`provider-card connection-${status}${selected ? ' selected' : ''}`} onClick={onSelect}>
    <div className="provider-avatar" aria-hidden="true">{provider.name.slice(0, 1).toUpperCase()}</div>
    <div className="provider-main">
      <button className="provider-name" data-drag-surface aria-pressed={selected} onClick={(e) => { e.stopPropagation(); onSelect() }}>{provider.name}</button>
      <div className="provider-meta"><div className="provider-url" title={provider.url}>{host}</div>{appliedCount > 0 && <span className="applied-count" title={`已应用到 ${appliedCount} 个目标`}>{appliedCount} 个目标</span>}</div>
    </div>
    <span className={`health-dot ${status}`} role="img" aria-label={label} title={`${label}${connection?.result ? ` · ${connection.result.latency_ms} ms` : ''}`} />
    {selected && <span className="selected-mark" title="待应用"><Icon name="check" size={15} /></span>}
    <button className="icon-btn provider-details" aria-label={`查看 ${provider.name} 详情`} title="连接、模型、额度与管理" onClick={(e) => { e.stopPropagation(); onDetails() }}><Icon name="more" size={17} /></button>
  </article>
}
