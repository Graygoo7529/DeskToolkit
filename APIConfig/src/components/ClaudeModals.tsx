import { useState } from 'react'
import { open } from '@tauri-apps/plugin-dialog'
import type { ClaudeHome, ClaudeProvider } from '../types'
import { ModalShell } from './Modals'

export function ClaudeHomeModal({
  original,
  onClose,
  onSave,
}: {
  original: ClaudeHome | null
  onClose: () => void
  onSave: (originalName: string | null, name: string, location: string) => void
}) {
  const [name, setName] = useState(original?.name ?? '')
  const [location, setLocation] = useState(original?.location ?? '')

  const pickDir = async () => {
    try {
      const dir = await open({ directory: true, title: '选择 Claude 配置目录' })
      if (typeof dir === 'string') setLocation(dir)
    } catch {
      /* 用户取消 */
    }
  }

  return (
    <ModalShell title={original ? '编辑 Claude 配置' : '添加 Claude 配置'} onClose={onClose}>
      <label className="field">
        <span>名称</span>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="例如 tokenadvent"
        />
      </label>
      <label className="field">
        <span>配置目录</span>
        <div className="input-with-btn">
          <input
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="例如 D:\\ClaudeData"
          />
          <button className="btn btn-ghost" onClick={pickDir}>
            浏览…
          </button>
        </div>
        <small className="field-hint">面板会读取或创建该目录下的 settings.json。</small>
      </label>
      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={onClose}>
          取消
        </button>
        <button
          className="btn btn-primary"
          disabled={!name.trim() || !location.trim()}
          onClick={() => onSave(original?.name ?? null, name, location)}
        >
          保存
        </button>
      </div>
    </ModalShell>
  )
}

export function ClaudeProviderModal({
  original,
  onClose,
  onSave,
}: {
  original: ClaudeProvider | null
  onClose: () => void
  onSave: (originalName: string | null, name: string, url: string, token: string) => void
}) {
  const [name, setName] = useState(original?.name ?? '')
  const [url, setUrl] = useState(original?.url ?? '')
  const [token, setToken] = useState('')
  const [showToken, setShowToken] = useState(false)

  return (
    <ModalShell title={original ? '编辑 Claude 中转站' : '添加 Claude 中转站'} onClose={onClose}>
      <label className="field">
        <span>名称</span>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="例如 TokenAdvent"
        />
      </label>
      <label className="field">
        <span>ANTHROPIC_BASE_URL</span>
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://api.example.com"
        />
      </label>
      <label className="field">
        <span>ANTHROPIC_AUTH_TOKEN</span>
        <div className="input-with-btn">
          <input
            type={showToken ? 'text' : 'password'}
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder={original ? '留空则保留当前 Token' : '输入 Bearer Token'}
          />
          <button className="btn btn-ghost" onClick={() => setShowToken((shown) => !shown)}>
            {showToken ? '隐藏' : '显示'}
          </button>
        </div>
      </label>
      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={onClose}>
          取消
        </button>
        <button
          className="btn btn-primary"
          disabled={!name.trim() || !url.trim() || (!original && !token.trim())}
          onClick={() => onSave(original?.name ?? null, name, url, token)}
        >
          保存
        </button>
      </div>
    </ModalShell>
  )
}
