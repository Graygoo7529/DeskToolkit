import type { Provider } from '../types'

interface Props {
  provider: Provider
  selected: boolean
  onSelect: () => void
  onEdit: () => void
  onDelete: () => void
}

export default function ProviderCard({ provider, selected, onSelect, onEdit, onDelete }: Props) {
  return (
    <div
      className={`card provider-card${selected ? ' selected' : ''}`}
      onClick={onSelect}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onSelect()}
    >
      <div className="card-head">
        <span className="card-title">{provider.name}</span>
        {selected && <span className="tag tag-accent">已选择</span>}
      </div>
      <div className="card-row mono" title={provider.url}>
        {provider.url}
      </div>
      <div className="card-row mono dim">{provider.key_masked}</div>
      <div className="card-actions" onClick={(e) => e.stopPropagation()}>
        <button className="btn btn-ghost" onClick={onEdit}>
          编辑
        </button>
        <button className="btn btn-danger" onClick={onDelete}>
          删除
        </button>
      </div>
    </div>
  )
}
