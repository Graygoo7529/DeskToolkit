import { useEffect, useState } from 'react'
import { open } from '@tauri-apps/plugin-dialog'
import * as api from '../api'
import type { State } from '../types'
import type { DataDirReport } from '../api'
import { ModalShell } from './Modals'
import Icon from './Icon'

export default function StorageModal({ current, onClose, onChange }: { current?: string; onClose: () => void; onChange: (state: State) => void }) {
  const [path, setPath] = useState('')
  const [report, setReport] = useState<DataDirReport | null>(null)
  const [confirmBackup, setConfirmBackup] = useState(false)
  const [checking, setChecking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const browse = async () => {
    setBusy(true); setError('')
    try {
      const selected = await open({ directory: true, multiple: false, title: '选择 APIConfig 数据目录' })
      if (typeof selected === 'string') setPath(selected)
    } catch (e) { setError(String(e)) } finally { setBusy(false) }
  }
  const inspect = async (value: string) => {
    const trimmed = value.trim()
    setReport(null); setConfirmBackup(false); setChecking(!!trimmed)
    if (!trimmed) { setChecking(false); return }
    try {
      const next = await api.inspectDataDir(trimmed)
      setReport(next)
      setConfirmBackup(next.status === 'invalid')
    } catch (e) { setError(String(e)) } finally { setChecking(false) }
  }
  useEffect(() => { const timer = window.setTimeout(() => { void inspect(path) }, 280); return () => window.clearTimeout(timer) }, [path])
  const save = async () => {
    setBusy(true); setError('')
    try {
      if (report?.status === 'invalid' && !confirmBackup) { setConfirmBackup(true); return }
      onChange(await api.changeDataDir(path.trim(), confirmBackup)); onClose()
    }
    catch (e) { if (String(e).includes('DATA_DIR_CONFIRM_REQUIRED')) setConfirmBackup(true); else setError(String(e)) } finally { setBusy(false) }
  }
  return <ModalShell title="数据目录" onClose={() => !busy && onClose()}>
    {current && <div className="storage-current"><span className="eyebrow">当前使用</span><p>{current}</p><button className="text-btn" disabled={busy} onClick={() => api.openDataDir().catch((e) => setError(String(e)))}><Icon name="folder" size={14} />在文件管理器中打开</button></div>}
    <div className="storage-files"><div><strong>codex.toml</strong><span>Codex Homes · Providers · 查询设置</span></div><div><strong>claude.toml</strong><span>Claude 配置目标 · Providers · 查询设置</span></div><div><strong>apis.toml</strong><span>API Probe 账号 · 协议 · 额度与控制台入口</span></div><div><strong>definitions/</strong><span>额度布局 · 查询适配器 · 自定义方案</span></div></div>
    <fieldset disabled={busy}>
      <label className="field"><span>新的数据目录</span><div className="input-with-btn"><input value={path} onChange={(e) => setPath(e.target.value)} placeholder="选择目录或输入绝对路径" /><button className="btn btn-ghost" onClick={browse}>选择目录</button></div></label>
    </fieldset>
    {report && <div className={`storage-report ${report.status}`} role="status"><strong>{report.message}</strong>{report.status === 'invalid' && <span>将先备份此目录的全部内容，再初始化 APIConfig 配置。</span>}{report.backup_path && <small>备份位置：{report.backup_path}</small>}</div>}
    <p className="hint">应用会自动识别目录状态：空目录初始化，有效配置直接使用，旧版配置自动迁移。不会复制当前目录。</p>
    {confirmBackup && <div className="storage-confirm"><strong>此目录包含无法识别的内容</strong><span>继续会把原目录备份到同级备份目录，然后创建新的 APIConfig 配置。</span></div>}
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="modal-actions"><button className="btn btn-ghost" disabled={busy} onClick={onClose}>取消</button><button className="btn btn-primary" disabled={busy || checking || !path.trim() || report?.path !== path.trim()} onClick={save}>{busy ? '处理中…' : checking ? '检查中…' : confirmBackup ? '备份并初始化' : report?.status === 'empty' ? '初始化并使用' : '使用此目录'}</button></div>
  </ModalShell>
}
