import type { Home, HomeStatus, Provider } from '../types'

interface Props {
  home: Home
  status: HomeStatus | undefined
  selectedProvider: Provider | null
  busy: boolean
  onApply: () => void
  onEdit: () => void
  onDelete: () => void
}

export default function HomeCard({
  home,
  status,
  selectedProvider,
  busy,
  onApply,
  onEdit,
  onDelete,
}: Props) {
  return (
    <div className="card home-card">
      <div className="home-main">
        <div className="card-head">
          <span className="card-title">{home.name}</span>
          {status?.matched_provider ? (
            <span className="tag tag-ok">当前：{status.matched_provider}</span>
          ) : (
            <span className="tag tag-dim">未匹配 Provider</span>
          )}
        </div>
        <div className="card-row mono" title={home.location}>
          {home.location}
        </div>
        <div className="status-row">
          <span className={`dot ${status?.config_exists ? 'ok' : 'warn'}`} />
          <span className="status-text mono">
            config.toml：{status?.base_url ?? (status?.config_exists ? '未设置 base_url' : '不存在')}
          </span>
        </div>
        <div className="status-row">
          <span className={`dot ${status?.auth_exists ? 'ok' : 'warn'}`} />
          <span className="status-text mono">
            auth.json：{status?.api_key_masked ?? (status?.auth_exists ? '未设置 Key' : '不存在')}
          </span>
        </div>
      </div>
      <div className="home-side">
        <button
          className="btn btn-primary"
          disabled={!selectedProvider || busy}
          title={selectedProvider ? `应用「${selectedProvider.name}」到此 Home` : '先选择一个 Provider'}
          onClick={onApply}
        >
          {busy ? '应用中…' : selectedProvider ? `应用「${selectedProvider.name}」` : '应用 Provider'}
        </button>
        <div className="side-actions">
          <button className="btn btn-ghost" onClick={onEdit}>
            编辑
          </button>
          <button className="btn btn-danger" onClick={onDelete}>
            删除
          </button>
        </div>
      </div>
    </div>
  )
}
