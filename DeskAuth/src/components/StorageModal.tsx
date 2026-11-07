import { useEffect, useState } from 'react'
import { open, save } from '@tauri-apps/plugin-dialog'
import { api } from '../api'
import type { AppState, Notify } from '../types'
import Modal from './Modal'
import Icon from './Icon'

export default function StorageModal({ state, onChange, onClose, notify }: { state: AppState; onChange: (state: AppState) => void; onClose: () => void; notify: Notify }) {
  const [path, setPath] = useState(state.dataDir ?? '')
  const [busy, setBusy] = useState(false); const [error, setError] = useState('')
  const [importPath, setImportPath] = useState('')
  useEffect(() => { if (!state.dataDir) api.suggest().then(setPath).catch(() => {}) }, [state.dataDir])
  async function run(task: () => Promise<void>) { setBusy(true); setError(''); try { await task() } catch (e) { setError(String(e)) } finally { setBusy(false) } }
  return <Modal title="本地数据管理" onClose={onClose} busy={busy}>
    {state.dataDir && <div className="storage-current"><span className="eyebrow">当前数据目录</span><p className="mono selectable">{state.dataDir}</p><button className="text-btn" disabled={busy} onClick={() => run(api.openDirectory)}><Icon name="folder" size={14} />在文件管理器中打开</button></div>}
    <div className="storage-files"><div><Icon name="book" size={17} /><div><strong>accounts.json</strong><span>账户、密码、TOTP 密钥及关联联系方式</span></div></div><div><Icon name="clock" size={17} /><div><strong>accounts.previous.json</strong><span>每次保存前自动保留的上一版本</span></div></div></div>
    <p className="notice"><Icon name="info" size={17} /><span>账户资料与备份以<strong>明文 JSON</strong>保存，可直接读取和备份。</span></p>
    <fieldset disabled={busy}>
      <label className="field"><span>{state.dataDir ? '切换 / 重新连接目录' : '数据目录'}</span><div className="input-action browse"><input data-autofocus value={path} onChange={e => setPath(e.target.value)} placeholder="选择空目录或已有 DeskAuth 目录" /><button type="button" className="btn" onClick={() => run(async () => { const selected = await open({ directory: true, multiple: false, title: '选择 DeskAuth 数据目录' }); if (typeof selected === 'string') setPath(selected) })}>浏览</button></div></label>
      <p className="hint">空目录会初始化；已有账户库会直接读取。切换目录不会搬移当前数据，无关文件不会被覆盖。</p>
      <button className="btn full" disabled={!path.trim()} onClick={() => run(async () => { onChange(await api.directory(path.trim())); notify('数据目录已连接'); onClose() })}><Icon name="folder" size={15} />{state.dataDir ? '使用此目录' : '初始化 / 连接目录'}</button>
      {state.dataDir && <div className="backup-section"><div className="section-heading"><strong>备份与迁移</strong><span>本地 JSON</span></div><p className="hint">导入会合并新账户，跳过重复项，保留已有账户资料、密码及认证器。导出时请选择新的文件名。</p><div className="field-grid"><button className="btn" onClick={() => run(async () => { const file = await save({ title: '导出明文备份', defaultPath: `deskauth-backup-${new Date().toISOString().slice(0, 10)}.json`, filters: [{ name: 'DeskAuth 备份', extensions: ['json'] }] }); if (file) { await api.export(file); notify('备份已导出') } })}><Icon name="download" size={16} />导出备份</button><button className="btn" onClick={() => run(async () => { const file = await open({ title: '选择 DeskAuth 备份', multiple: false, filters: [{ name: 'DeskAuth 备份', extensions: ['json'] }] }); if (typeof file === 'string') setImportPath(file) })}><Icon name="upload" size={16} />导入备份</button></div>
        {importPath && <div className="import-confirm"><p className="mono selectable">{importPath}</p><button className="btn primary" onClick={() => run(async () => { const result = await api.import(importPath); onChange(result.state); setImportPath(''); notify(`已导入 ${result.added} 个账户，跳过 ${result.skipped} 个重复项`) })}>确认合并</button><button className="text-btn" onClick={() => setImportPath('')}>取消</button></div>}
      </div>}
    </fieldset>
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="modal-actions"><button className="btn" disabled={busy} onClick={onClose}>关闭</button></div>
  </Modal>
}
