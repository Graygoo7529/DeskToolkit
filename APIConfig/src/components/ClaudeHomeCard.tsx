import type { ClaudeHome, ClaudeProvider, ClaudeStatus } from '../types'
import type { ReactNode } from 'react'

interface Props {
  handle?: ReactNode
  home: ClaudeHome
  status: ClaudeStatus | undefined
  selectedProvider: ClaudeProvider | null
  busy: boolean
  onApply: () => void
  onEdit: () => void
  onDelete: () => void
}

export default function ClaudeHomeCard({
  handle,
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
          {handle}
          <span className="card-title">{home.name}</span>
          {status?.matched_provider ? (
            <span className="tag tag-ok">当前：{status.matched_provider}</span>
          ) : (
            <span className="tag tag-dim">未匹配中转站</span>
          )}
        </div>
        <div className="card-row mono" title={home.location}>
          {home.location}
        </div>
        <div className="status-row">
          <span className={`dot ${status?.settings_exists ? 'ok' : 'warn'}`} />
          <span className="status-text mono">
            settings.json：{status?.base_url ?? (status?.settings_exists ? '未设置 Base URL' : '不存在')}
          </span>
        </div>
        <div className="status-row">
          <span className={`dot ${status?.auth_token_masked ? 'ok' : 'warn'}`} />
          <span className="status-text mono">
            ANTHROPIC_AUTH_TOKEN：{status?.auth_token_masked ?? '未设置 Token'}
          </span>
        </div>
      </div>
      <div className="home-side">
        <button
          className="btn btn-primary"
          disabled={!selectedProvider || busy}
          title={selectedProvider ? `应用「${selectedProvider.name}」到此 Claude 配置` : '先选择一个中转站'}
          onClick={onApply}
        >
          {busy ? '应用中…' : selectedProvider ? `应用「${selectedProvider.name}」` : '应用中转站'}
        </button>
        <div className="side-actions">
          <button className="btn btn-ghost" disabled={busy} onClick={onEdit}>
            编辑
          </button>
          <button className="btn btn-danger" disabled={busy} onClick={onDelete}>
            删除
          </button>
        </div>
      </div>
    </div>
  )
}
