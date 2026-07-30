import { useCallback, useEffect, useState } from 'react'
import type { Home, Provider, State } from './types'
import * as api from './api'
import HomeCard from './components/HomeCard'
import ProviderCard from './components/ProviderCard'
import { ConfirmModal, HomeModal, ProviderModal } from './components/Modals'
import Toasts, { type Toast } from './components/Toasts'

type ModalState =
  | { kind: 'home'; original: Home | null }
  | { kind: 'provider'; original: Provider | null }
  | null

type ConfirmState =
  | { kind: 'home'; item: Home }
  | { kind: 'provider'; item: Provider }
  | null

let toastSeq = 0

export default function App() {
  const [state, setState] = useState<State | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null)
  const [modal, setModal] = useState<ModalState>(null)
  const [confirm, setConfirm] = useState<ConfirmState>(null)
  const [toasts, setToasts] = useState<Toast[]>([])
  const [busyHome, setBusyHome] = useState<string | null>(null)

  const pushToast = useCallback((kind: Toast['kind'], text: string) => {
    const id = ++toastSeq
    setToasts((ts) => [...ts, { id, kind, text }])
    window.setTimeout(() => setToasts((ts) => ts.filter((t) => t.id !== id)), 3600)
  }, [])

  const refresh = useCallback(async () => {
    try {
      setState(await api.getState())
      setLoadError(null)
    } catch (e) {
      setLoadError(String(e))
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const handleApply = async (homeName: string) => {
    if (!selectedProvider) return
    setBusyHome(homeName)
    try {
      setState(await api.applyProvider(homeName, selectedProvider))
      pushToast('success', `已将「${selectedProvider}」应用到「${homeName}」`)
    } catch (e) {
      pushToast('error', String(e))
    } finally {
      setBusyHome(null)
    }
  }

  const handleSaveHome = async (originalName: string | null, name: string, location: string) => {
    try {
      setState(await api.saveHome(originalName, name, location))
      setModal(null)
      pushToast('success', originalName ? `已更新 Home「${name}」` : `已添加 Home「${name}」`)
    } catch (e) {
      pushToast('error', String(e))
    }
  }

  const handleSaveProvider = async (
    originalName: string | null,
    name: string,
    url: string,
    key: string,
  ) => {
    try {
      setState(await api.saveProvider(originalName, name, url, key))
      setModal(null)
      pushToast('success', originalName ? `已更新 Provider「${name}」` : `已添加 Provider「${name}」`)
    } catch (e) {
      pushToast('error', String(e))
    }
  }

  const handleConfirmDelete = async () => {
    if (!confirm) return
    try {
      if (confirm.kind === 'home') {
        setState(await api.deleteHome(confirm.item.name))
        pushToast('success', `已删除 Home「${confirm.item.name}」（.codex 目录未受影响）`)
      } else {
        setState(await api.deleteProvider(confirm.item.name))
        if (selectedProvider === confirm.item.name) setSelectedProvider(null)
        pushToast('success', `已删除 Provider「${confirm.item.name}」`)
      }
    } catch (e) {
      pushToast('error', String(e))
    } finally {
      setConfirm(null)
    }
  }

  if (loadError) {
    return (
      <div className="app app-center">
        <div className="fatal">
          <h2>加载失败</h2>
          <p>{loadError}</p>
          <button className="btn btn-primary" onClick={refresh}>
            重试
          </button>
        </div>
      </div>
    )
  }

  if (!state) {
    return (
      <div className="app app-center">
        <div className="loading">加载中…</div>
      </div>
    )
  }

  const selected = state.providers.find((p) => p.name === selectedProvider) ?? null

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <div className="logo">C</div>
          <div>
            <h1>Codex 配置面板</h1>
            <p className="subtitle">管理 Codex Home 与 Provider，一键切换 API 来源</p>
          </div>
        </div>
        <button
          className="datadir-chip"
          title="打开数据目录（homes.toml / providers.toml）"
          onClick={() => api.openDataDir().catch((e) => pushToast('error', String(e)))}
        >
          <span className="chip-label">数据目录</span>
          <span className="chip-path">{state.data_dir}</span>
        </button>
      </header>

      <section className="section">
        <div className="section-head">
          <h2>
            Providers <span className="count">{state.providers.length}</span>
          </h2>
          <button className="btn btn-primary" onClick={() => setModal({ kind: 'provider', original: null })}>
            + 添加 Provider
          </button>
        </div>
        <p className="hint">点击卡片选择一个 Provider，然后到下方 Home 上应用它。</p>
        {state.providers.length === 0 ? (
          <div className="empty">还没有 Provider，点击右上角「添加 Provider」创建。</div>
        ) : (
          <div className="provider-grid">
            {state.providers.map((p) => (
              <ProviderCard
                key={p.name}
                provider={p}
                selected={p.name === selectedProvider}
                onSelect={() => setSelectedProvider(p.name === selectedProvider ? null : p.name)}
                onEdit={() => setModal({ kind: 'provider', original: p })}
                onDelete={() => setConfirm({ kind: 'provider', item: p })}
              />
            ))}
          </div>
        )}
      </section>

      <section className="section">
        <div className="section-head">
          <h2>
            Codex Homes <span className="count">{state.homes.length}</span>
          </h2>
          <button className="btn btn-primary" onClick={() => setModal({ kind: 'home', original: null })}>
            + 添加 Home
          </button>
        </div>
        {state.homes.length === 0 ? (
          <div className="empty">还没有 Home，点击右上角「添加 Home」创建。</div>
        ) : (
          <div className="home-list">
            {state.homes.map((h) => (
              <HomeCard
                key={h.name}
                home={h}
                status={state.statuses[h.name]}
                selectedProvider={selected}
                busy={busyHome === h.name}
                onApply={() => handleApply(h.name)}
                onEdit={() => setModal({ kind: 'home', original: h })}
                onDelete={() => setConfirm({ kind: 'home', item: h })}
              />
            ))}
          </div>
        )}
      </section>

      {modal?.kind === 'home' && (
        <HomeModal
          original={modal.original}
          onClose={() => setModal(null)}
          onSave={handleSaveHome}
        />
      )}
      {modal?.kind === 'provider' && (
        <ProviderModal
          original={modal.original}
          onClose={() => setModal(null)}
          onSave={handleSaveProvider}
        />
      )}
      {confirm && (
        <ConfirmModal
          title={confirm.kind === 'home' ? '删除 Home' : '删除 Provider'}
          message={
            confirm.kind === 'home'
              ? `确定从面板删除 Home「${confirm.item.name}」吗？仅移除面板记录，不会改动其 .codex 目录。`
              : `确定删除 Provider「${confirm.item.name}」吗？`
          }
          onCancel={() => setConfirm(null)}
          onConfirm={handleConfirmDelete}
        />
      )}
      <Toasts toasts={toasts} />
    </div>
  )
}
