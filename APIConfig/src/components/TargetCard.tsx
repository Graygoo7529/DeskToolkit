import type { Home, Provider } from '../types'
import Icon from './Icon'
import { providerStyle } from '../providerColor'

export default function TargetCard({ home, current, currentProvider, selected, busy, applying, flashed, onApply, onDetails }: {
  home: Home; current: string | null; currentProvider?: Provider; selected: Provider | null; busy: boolean; applying: boolean; flashed: boolean
  onApply: () => void; onDetails: () => void
}) {
  const matches = !!selected && current === selected.name
  return <article style={providerStyle(currentProvider)} className={`target-card${currentProvider ? ' has-provider' : ''}${flashed ? ' just-applied' : ''}${matches ? ' matches' : ''}`}>
    <div className="target-heading"><div className="target-icon"><Icon name="folder" size={18} /></div><h3 className="card-title">{home.name}</h3>
      <button className="icon-btn" aria-label={`查看 ${home.name} 配置`} onClick={onDetails}><Icon name="more" size={17} /></button>
    </div>
    <p className="target-path" title={home.location}>{home.location}</p>
    <div className="target-action">
      <div className="target-current"><span className={`tiny-dot${current ? ' active' : ''}`} /><span title={current ?? undefined}>{current ?? '未匹配 Provider'}</span></div>
      <button className={`btn ${matches ? 'btn-applied' : 'btn-primary'}`} disabled={!selected || busy || matches}
        aria-label={matches ? `${home.name} 已使用 ${current}` : selected ? `应用「${selected.name}」到「${home.name}」` : `为 ${home.name} 选择 Provider`}
        title={selected ? `将 ${selected.name} 应用到 ${home.name}` : '先在左侧选择 Provider'} onClick={onApply}>
        {applying ? '应用中…' : matches ? <><Icon name="check" size={14} />已生效</> : <>应用<Icon name="arrow" size={14} /></>}
      </button>
    </div>
  </article>
}
