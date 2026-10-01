import { useCallback, useEffect, useState } from 'react'
import type { Scene, State } from './types'
import * as api from './api'
import ScenePanel from './components/ScenePanel'
import Toasts, { type Toast } from './components/Toasts'

let toastSeq = 0

export default function App() {
  const [state, setState] = useState<State | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [toasts, setToasts] = useState<Toast[]>([])
  const [activePage, setActivePage] = useState<Scene>('codex')
  const pushToast = useCallback((kind: Toast['kind'], text: string) => {
    const id = ++toastSeq
    setToasts((ts) => [...ts, { id, kind, text }])
    window.setTimeout(() => setToasts((ts) => ts.filter((t) => t.id !== id)), 5000)
  }, [])
  const refresh = useCallback(async () => {
    try { setState(await api.getState()); setLoadError(null) }
    catch (e) { setLoadError(String(e)) }
  }, [])
  useEffect(() => { void refresh() }, [refresh])

  if (loadError) return <div className="app app-center"><div className="fatal"><h2>加载失败</h2><p>{loadError}</p><button className="btn btn-primary" onClick={refresh}>重试</button></div></div>
  if (!state) return <div className="app app-center"><div className="loading">加载中…</div></div>

  return <div className="app">
    <header className="topbar">
      <div className="brand"><div className="logo">A</div><div><h1>APIConfig</h1>
        <p className="subtitle">{activePage === 'codex' ? '管理 Codex Home 与 Provider，一键切换 API 来源' : '管理 Claude 配置目录与中转站，一键切换 API 来源'}</p>
      </div></div>
      <button className="datadir-chip" title="打开数据目录（Codex 与 Claude 的列表及密钥）" onClick={() => api.openDataDir().catch((e) => pushToast('error', String(e)))}>
        <span className="chip-label">数据目录</span><span className="chip-path">{state.data_dir}</span>
      </button>
    </header>
    <nav className="page-tabs" aria-label="配置场景" role="tablist">
      {(['codex', 'claude'] as const).map((scene) => <button key={scene} id={`tab-${scene}`} role="tab" aria-selected={activePage === scene} aria-controls={`panel-${scene}`}
        className={`page-tab${activePage === scene ? ' active' : ''}`} onClick={() => setActivePage(scene)}>{scene === 'codex' ? 'Codex' : 'Claude'}</button>)}
    </nav>
    {(['codex', 'claude'] as const).map((scene) => <div key={scene} id={`panel-${scene}`} role="tabpanel" aria-labelledby={`tab-${scene}`} hidden={activePage !== scene}>
      <ScenePanel scene={scene} state={state} onState={setState} pushToast={pushToast} />
    </div>)}
    <Toasts toasts={toasts} />
  </div>
}
