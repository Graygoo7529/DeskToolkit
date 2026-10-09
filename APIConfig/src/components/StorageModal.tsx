import { useState } from 'react'
import { open } from '@tauri-apps/plugin-dialog'
import * as api from '../api'
import type { State } from '../types'
import { ModalShell } from './Modals'
import Icon from './Icon'

export default function StorageModal({ current, onClose, onChange }: { current?: string; onClose: () => void; onChange: (state: State) => void }) {
  const [path, setPath] = useState('')
  const [mode, setMode] = useState<'copy' | 'existing'>(current ? 'copy' : 'existing')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const browse = async () => {
    setBusy(true); setError('')
    try {
      const selected = await open({ directory: true, multiple: false, title: '选择 APIConfig 数据目录' })
      if (typeof selected === 'string') setPath(selected)
    } catch (e) { setError(String(e)) } finally { setBusy(false) }
  }
  const save = async () => {
    setBusy(true); setError('')
    try { onChange(await api.changeDataDir(path.trim(), mode)); onClose() }
    catch (e) { setError(String(e)) } finally { setBusy(false) }
  }
  return <ModalShell title="数据目录" onClose={() => !busy && onClose()}>
    {current && <div className="storage-current"><span className="eyebrow">当前使用</span><p>{current}</p><button className="text-btn" disabled={busy} onClick={() => api.openDataDir().catch((e) => setError(String(e)))}><Icon name="folder" size={14} />在文件管理器中打开</button></div>}
    <div className="storage-files"><div><strong>codex.toml</strong><span>Codex Homes · Providers · 查询设置</span></div><div><strong>claude.toml</strong><span>Claude 配置目标 · Providers · 查询设置</span></div><div><strong>apis.toml</strong><span>API Probe 账号 · 协议 · 额度与控制台入口</span></div></div>
    <fieldset disabled={busy}>
      <label className="field"><span>新的数据目录</span><div className="input-with-btn"><input value={path} onChange={(e) => setPath(e.target.value)} placeholder="选择目录或输入绝对路径" /><button className="btn btn-ghost" onClick={browse}>选择目录</button></div></label>
      <div className="storage-modes" role="group" aria-label="目录切换方式">
        <button className={`storage-mode${mode === 'copy' ? ' active' : ''}`} aria-pressed={mode === 'copy'} disabled={!current} onClick={() => setMode('copy')}><strong>复制当前配置</strong><span>带上四个分页的配置与 Key，原目录保留。</span></button>
        <button className={`storage-mode${mode === 'existing' ? ' active' : ''}`} aria-pressed={mode === 'existing'} onClick={() => setMode('existing')}><strong>使用已有配置</strong><span>切换到此目录中的数据，旧版文件自动迁移。</span></button>
      </div>
    </fieldset>
    <p className="hint">切换后立即生效，下次启动沿用此目录。目标的 Codex / Claude 配置路径保持不变；已有配置不会被复制覆盖。</p>
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="modal-actions"><button className="btn btn-ghost" disabled={busy} onClick={onClose}>取消</button><button className="btn btn-primary" disabled={busy || !path.trim()} onClick={save}>{busy ? '处理中…' : mode === 'copy' ? '复制并切换' : '使用此目录'}</button></div>
  </ModalShell>
}
