import { useEffect, useState } from 'react'
import { open } from '@tauri-apps/plugin-dialog'
import { api } from '../api'
import type { AppState, Notify } from '../types'
import Modal from './Modal'
import Icon from './Icon'

export default function StorageModal({ state, onChange, onClose, notify }: { state: AppState; onChange: (state: AppState) => void; onClose: () => void; notify: Notify }) {
  const [path, setPath] = useState(state.dataDir ?? '')
  const [busy, setBusy] = useState(false); const [error, setError] = useState('')
  const [importPath, setImportPath] = useState(''); const [exportPath, setExportPath] = useState('')
  useEffect(() => { if (!state.dataDir) api.suggest().then(setPath).catch(() => {}) }, [state.dataDir])
  async function run(task: () => Promise<void>) {
    if (busy) return; setBusy(true); setError('')
    try { await task() } catch (e) { setError(String(e)); try { onChange(await api.state()) } catch { /* Keep the displayed state if IPC is unavailable. */ } } finally { setBusy(false) }
  }
  return <Modal title="本地数据管理" onClose={onClose} busy={busy}>
    {state.dataDir && <div className="storage-current"><span className="eyebrow">当前数据目录</span><p className="mono selectable">{state.dataDir}</p><button className="text-btn" disabled={busy} onClick={() => run(api.openDirectory)}><Icon name="folder" size={14} />在文件管理器中打开</button></div>}
    <div className="storage-files"><div><Icon name="book" size={17} /><div><strong>accounts/&lt;账户 ID&gt;.json</strong><span>一账户一文件：登录资料、联系方式与 2FA</span></div></div><div><Icon name="clock" size={17} /><div><strong>history/&lt;账户 ID&gt;.json</strong><span>该账户修改或删除前的上一条记录</span></div></div></div>
    <p className="hint storage-format">明文 JSON · 本地存储</p>
    <fieldset disabled={busy}>
      <label className="field"><span>{state.dataDir ? '切换 / 重新连接目录' : '数据目录'}</span><div className="input-action browse"><input data-autofocus value={path} onChange={e => setPath(e.target.value)} placeholder="选择空目录或已有 DeskAuth 目录" /><button type="button" className="btn" onClick={() => run(async () => { const selected = await open({ directory: true, multiple: false, title: '选择 DeskAuth 数据目录' }); if (typeof selected === 'string') setPath(selected) })}>浏览</button></div></label>
      <details className="help-details"><summary>目录使用说明</summary><p>空目录会初始化；已有目录按 deskauth.json 标记读取。切换目录不会搬移文件，手动修改账户 JSON 后可重新连接刷新。</p></details>
      <button className="btn full" disabled={!path.trim()} onClick={() => run(async () => { onChange(await api.directory(path.trim())); notify('数据目录已连接'); onClose() })}><Icon name="folder" size={15} />{state.dataDir ? '使用此目录' : '初始化 / 连接目录'}</button>
      {state.dataDir && <div className="backup-section"><div className="section-heading"><strong>备份与迁移</strong></div><details className="help-details"><summary>备份与导入规则</summary><p>导出在所选位置新建备份目录。导入只合并新账户，已有资料、密码与 2FA 配置优先。</p></details><div className="field-grid"><button className="btn" onClick={() => run(async () => {
        const parent = await open({ title: '选择备份保存位置', directory: true, multiple: false })
        if (typeof parent !== 'string') return
        const name = `deskauth-backup-${new Date().toISOString().replace(/[:.]/g, '-')}-${crypto.randomUUID().slice(0, 8)}`
        const target = `${parent.replace(/[\\/]$/, '')}/${name}`
        await api.export(target); setExportPath(target); notify('账户目录备份已导出')
      })}><Icon name="download" size={16} />导出备份</button><button className="btn" onClick={() => run(async () => {
        const selected = await open({ title: '选择 DeskAuth 备份目录', directory: true, multiple: false })
        if (typeof selected === 'string') setImportPath(selected)
      })}><Icon name="upload" size={16} />导入备份</button></div>
        {exportPath && <p className="hint mono selectable backup-path">{exportPath}</p>}
        {importPath && <div className="import-confirm"><p className="mono selectable">{importPath}</p><button className="btn primary" onClick={() => run(async () => { const result = await api.import(importPath); onChange(result.state); setImportPath(''); notify(`已导入 ${result.added} 个账户，跳过 ${result.skipped} 个重复项`) })}>确认合并</button><button className="text-btn" onClick={() => setImportPath('')}>取消</button></div>}
      </div>}
    </fieldset>
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="modal-actions"><button className="btn" disabled={busy} onClick={onClose}>关闭</button></div>
  </Modal>
}
