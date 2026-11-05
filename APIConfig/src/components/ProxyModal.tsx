import { useState } from 'react'
import * as api from '../api'
import type { ProxySettings, State } from '../types'
import { ModalShell } from './Modals'

export default function ProxyModal({ current, onClose, onChange }: {
  current: ProxySettings
  onClose: () => void
  onChange: (state: State) => void
}) {
  const [enabled, setEnabled] = useState(current.enabled)
  const [httpsProxy, setHttpsProxy] = useState(current.https_proxy)
  const [httpsProxys, setHttpsProxys] = useState(current.https_proxys)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const save = async () => {
    setBusy(true)
    setError('')
    try {
      const next = await api.saveProxySettings({ enabled, https_proxy: httpsProxy.trim(), https_proxys: httpsProxys.trim() })
      onChange(next)
      onClose()
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }

  return <ModalShell title="地区代理" onClose={() => !busy && onClose()}>
    <p className="hint proxy-description">代理设置作用于 Codex、Claude 和 API Probe 的连接、模型查询及额度查询。默认使用本机 7897 端口。</p>
    <label className="proxy-switch-row">
      <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} disabled={busy} />
      <span><strong>启用地区代理</strong><small>关闭后所有查询直接连接目标 API</small></span>
    </label>
    <label className="field"><span>https_proxy</span><input value={httpsProxy} onChange={(e) => setHttpsProxy(e.target.value)} placeholder="http://127.0.0.1:7897" disabled={busy} /></label>
    <label className="field"><span>https_proxys</span><input value={httpsProxys} onChange={(e) => setHttpsProxys(e.target.value)} placeholder="http://127.0.0.1:7897" disabled={busy} /></label>
    <p className="hint">两个地址默认保持一致；当 https_proxy 为空时，程序会回退使用 https_proxys。</p>
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="modal-actions"><button className="btn btn-ghost" disabled={busy} onClick={onClose}>取消</button><button className="btn btn-primary" disabled={busy} onClick={() => void save()}>{busy ? '保存中…' : '保存设置'}</button></div>
  </ModalShell>
}
