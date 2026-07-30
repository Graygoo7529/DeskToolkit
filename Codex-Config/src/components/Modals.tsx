import { useEffect, useState } from 'react'
import { open } from '@tauri-apps/plugin-dialog'
import type { Home, Provider } from '../types'

function useEscape(onClose: () => void) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])
}

function ModalShell({
  title,
  children,
  onClose,
}: {
  title: string
  children: React.ReactNode
  onClose: () => void
}) {
  useEscape(onClose)
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <h3 className="modal-title">{title}</h3>
        {children}
      </div>
    </div>
  )
}

export function HomeModal({
  original,
  onClose,
  onSave,
}: {
  original: Home | null
  onClose: () => void
  onSave: (originalName: string | null, name: string, location: string) => void
}) {
  const [name, setName] = useState(original?.name ?? '')
  const [location, setLocation] = useState(original?.location ?? '')

  const pickDir = async () => {
    try {
      const dir = await open({ directory: true, title: '选择 .codex 目录' })
      if (typeof dir === 'string') setLocation(dir)
    } catch {
      /* 用户取消 */
    }
  }

  return (
    <ModalShell title={original ? '编辑 Home' : '添加 Home'} onClose={onClose}>
      <label className="field">
        <span>名称</span>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="例如 stable"
        />
      </label>
      <label className="field">
        <span>.codex 目录位置</span>
        <div className="input-with-btn">
          <input
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="例如 C:\Users\you\.codex"
          />
          <button className="btn btn-ghost" onClick={pickDir}>
            浏览…
          </button>
        </div>
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

export function ProviderModal({
  original,
  onClose,
  onSave,
}: {
  original: Provider | null
  onClose: () => void
  onSave: (originalName: string | null, name: string, url: string, key: string) => void
}) {
  const [name, setName] = useState(original?.name ?? '')
  const [url, setUrl] = useState(original?.url ?? '')
  const [key, setKey] = useState('')
  const [showKey, setShowKey] = useState(false)

  return (
    <ModalShell title={original ? '编辑 Provider' : '添加 Provider'} onClose={onClose}>
      <label className="field">
        <span>名称</span>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="例如 Example Provider"
        />
      </label>
      <label className="field">
        <span>Base URL</span>
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://api.example.com"
        />
      </label>
      <label className="field">
        <span>API Key</span>
        <div className="input-with-btn">
          <input
            type={showKey ? 'text' : 'password'}
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder={original ? '留空则保留当前 Key' : '输入 API Key'}
          />
          <button className="btn btn-ghost" onClick={() => setShowKey((s) => !s)}>
            {showKey ? '隐藏' : '显示'}
          </button>
        </div>
      </label>
      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={onClose}>
          取消
        </button>
        <button
          className="btn btn-primary"
          disabled={!name.trim() || !url.trim() || (!original && !key.trim())}
          onClick={() => onSave(original?.name ?? null, name, url, key)}
        >
          保存
        </button>
      </div>
    </ModalShell>
  )
}

export function ConfirmModal({
  title,
  message,
  onCancel,
  onConfirm,
}: {
  title: string
  message: string
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <ModalShell title={title} onClose={onCancel}>
      <p className="confirm-message">{message}</p>
      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={onCancel}>
          取消
        </button>
        <button className="btn btn-danger-solid" onClick={onConfirm}>
          确认删除
        </button>
      </div>
    </ModalShell>
  )
}
