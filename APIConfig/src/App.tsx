import { useCallback, useEffect, useState } from 'react'
import type { State } from './types'
import * as api from './api'
import ScenePanel from './components/ScenePanel'
import Icon from './components/Icon'
import StorageModal from './components/StorageModal'
import ProxyModal from './components/ProxyModal'
import Toasts, { type Toast } from './components/Toasts'
import ApiPanel from './components/ApiPanel'

let toastSeq = 0
const pages = [{ id: 'codex', title: 'Codex', mark: 'C' }, { id: 'claude', title: 'Claude', mark: '✳' }, { id: 'api', title: 'API Probe', mark: 'A' }] as const

export default function App() {
  const [state, setState] = useState<State | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [toasts, setToasts] = useState<Toast[]>([])
  const [activePage, setActivePage] = useState<'codex' | 'claude' | 'api'>('codex')
  const [storageOpen, setStorageOpen] = useState(false)
  const [proxyOpen, setProxyOpen] = useState(false)
  const [proxyBusy, setProxyBusy] = useState(false)
  const [storageRevision, setStorageRevision] = useState(0)
  const pushToast = useCallback((kind: Toast['kind'], text: string) => {
    const id = ++toastSeq
    setToasts((ts) => [...ts, { id, kind, text }])
    window.setTimeout(() => setToasts((ts) => ts.filter((t) => t.id !== id)), 4200)
  }, [])
  const refresh = useCallback(async () => {
    try { setState(await api.getState()); setLoadError(null) }
    catch (e) { setLoadError(String(e)) }
  }, [])
  useEffect(() => { void refresh() }, [refresh])
  const toggleProxy = async () => {
    if (!state || proxyBusy) return
    setProxyBusy(true)
    try {
      const enabled = !state.proxy.enabled
      setState(await api.saveProxySettings({ ...state.proxy, enabled }))
      pushToast('success', enabled ? '地区代理已开启' : '地区代理已关闭')
    } catch (e) {
      pushToast('error', String(e))
    } finally {
      setProxyBusy(false)
    }
  }
  const storageModal = storageOpen && <StorageModal current={state?.data_dir} onClose={() => setStorageOpen(false)} onChange={(next) => { setState(next); setLoadError(null); setStorageRevision((v) => v + 1); pushToast('success', '已切换数据目录') }} />
  if (loadError) return <div className="app app-center"><div className="fatal"><h2>加载失败</h2><p>{loadError}</p><button className="btn btn-primary" onClick={refresh}>重试</button><button className="btn btn-ghost" onClick={() => setStorageOpen(true)}>选择数据目录</button></div>{storageModal}</div>
  if (!state) return <div className="app app-center"><div className="loading">正在准备配置…</div></div>
  return <div className="app">
    <header className="topbar">
      <div className="brand"><div className="logo"><Icon name="layers" size={23} /></div><div><h1>APIConfig</h1><span className="brand-note">你的 API，井然有序。</span></div></div>
      <nav className="page-tabs" aria-label="配置场景" role="tablist">
        {pages.map((page, index) => <button key={page.id} id={`tab-${page.id}`} role="tab" aria-selected={activePage === page.id} aria-controls={`panel-${page.id}`} tabIndex={activePage === page.id ? 0 : -1}
          className={`page-tab${activePage === page.id ? ' active' : ''}`} onClick={() => setActivePage(page.id)}
          onKeyDown={(e) => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return
            e.preventDefault()
            const next = e.key === 'Home' ? pages[0] : e.key === 'End' ? pages[pages.length - 1] : pages[(index + (e.key === 'ArrowRight' ? 1 : pages.length - 1)) % pages.length]
            setActivePage(next.id); document.getElementById(`tab-${next.id}`)?.focus()
          }}><span className={`tab-mark ${page.id}`} aria-hidden="true">{page.mark}</span>{page.title}</button>)}
      </nav>
      <div className="proxy-control">
        <button className={`proxy-toggle${state.proxy.enabled ? ' active' : ''}`} role="switch" aria-checked={state.proxy.enabled} disabled={proxyBusy} onClick={() => void toggleProxy()}>
          <span className="proxy-dot" />地区代理 {state.proxy.enabled ? '已开启' : '已关闭'}
        </button>
        <button className="icon-btn proxy-settings" aria-label="地区代理设置" title="地区代理设置" onClick={() => setProxyOpen(true)}><Icon name="more" size={16} /></button>
      </div>
      <button className="data-button icon-btn" aria-label="数据目录设置" title={state.data_dir} onClick={() => setStorageOpen(true)}><Icon name="folder" /><span>数据目录</span></button>
    </header>
    <main className="page-content" key={storageRevision}>
      {(['codex', 'claude'] as const).map((scene) => <div key={scene} className="scene-page" id={`panel-${scene}`} role="tabpanel" aria-labelledby={`tab-${scene}`} hidden={activePage !== scene}>
        <ScenePanel scene={scene} state={state} onState={(next) => setState((old) => old?.data_dir === next.data_dir ? next : old)} pushToast={pushToast} />
      </div>)}
      <div id="panel-api" role="tabpanel" className="scene-page api-page" aria-labelledby="tab-api" hidden={activePage !== 'api'}><ApiPanel visible={activePage === 'api'} pushToast={pushToast} /></div>
    </main>
    <Toasts toasts={toasts} />
    {storageModal}
    {proxyOpen && <ProxyModal current={state.proxy} onClose={() => setProxyOpen(false)} onChange={(next) => { setState(next); pushToast('success', '地区代理设置已保存') }} />}
  </div>
}
