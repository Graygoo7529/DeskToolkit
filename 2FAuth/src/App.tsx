import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { api } from './api'
import type { Account, AppState, TimeStatus } from './types'
import { timeLabel } from './clock'
import Icon from './components/Icon'
import AccountForm from './components/AccountForm'
import AccountDetail from './components/AccountDetail'
import StorageModal from './components/StorageModal'
import TimeModal from './components/TimeModal'

export default function App() {
  const [state, setState] = useState<AppState | null>(null); const [loadError, setLoadError] = useState('')
  const [selected, setSelected] = useState(''); const [query, setQuery] = useState(''); const [group, setGroup] = useState('')
  const [favorites, setFavorites] = useState(false); const [storage, setStorage] = useState(false)
  const [timeStatus, setTimeStatus] = useState<TimeStatus | null>(null); const [timeModal, setTimeModal] = useState(false)
  const acceptTime = useCallback((next: TimeStatus) => setTimeStatus(previous => previous && previous.revision > next.revision ? previous : next), [])
  const [form, setForm] = useState<Account | 'new' | null>(null)
  const [toast, setToast] = useState<{ message: string; error: boolean } | null>(null); const toastTimer = useRef<number>()
  const search = useRef<HTMLInputElement>(null)
  const notify = (message: string, error = false) => { setToast({ message, error }); window.clearTimeout(toastTimer.current); toastTimer.current = window.setTimeout(() => setToast(null), error ? 6500 : 3000) }
  const load = () => { setLoadError(''); api.state().then(setState).catch(e => setLoadError(String(e))) }
  useEffect(() => { load(); return () => window.clearTimeout(toastTimer.current) }, [])
  useEffect(() => {
    let stopped = false; let pending = false
    const refresh = async () => {
      if (pending) return
      pending = true
      try { const next = await api.timeStatus(); if (!stopped) acceptTime(next) } catch { /* The dialog provides a manual retry if IPC is unavailable. */ }
      finally { pending = false }
    }
    void refresh(); const timer = window.setInterval(refresh, 1000)
    window.addEventListener('focus', refresh)
    return () => { stopped = true; window.clearInterval(timer); window.removeEventListener('focus', refresh) }
  }, [acceptTime])
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k' && !form && !storage && !timeModal) { e.preventDefault(); search.current?.focus() } }
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key)
  }, [form, storage, timeModal])
  const groups = useMemo(() => Array.from(new Set(state?.accounts.map(a => a.group).filter(Boolean) ?? [])).sort(), [state])
  const accounts = useMemo(() => (state?.accounts ?? []).filter(a => (!favorites || a.favorite) && (!group || a.group === group) && `${a.issuer} ${a.account} ${a.group}`.toLocaleLowerCase().includes(query.toLocaleLowerCase().trim())).sort((a, b) => Number(b.favorite) - Number(a.favorite) || a.issuer.localeCompare(b.issuer) || a.account.localeCompare(b.account)), [state, favorites, group, query])
  const current = accounts.find(a => a.id === selected) ?? accounts[0]
  const changeState = (next: AppState) => {
    if (next.dataDir !== state?.dataDir) { setSelected(''); setQuery(''); setGroup(''); setFavorites(false) }
    else if (group && !next.accounts.some(a => a.group === group)) setGroup('')
    setState(next)
  }
  return <div className="app">
    <header className="topbar"><div className="brand"><div className="logo"><Icon name="shield" size={25} /></div><div><h1>2FAuth</h1><span className="brand-note">YOUR LOCAL AUTHENTICATOR</span></div></div><div className="topbar-context"><Icon name="shield" size={15} /><span>双因素认证</span></div><div className="topbar-right"><button className={`time-button ${timeStatus?.error ? "warning" : ""}`} aria-label="时间校准" onClick={() => setTimeModal(true)}><Icon name="clock" size={15} /><span>{timeLabel(timeStatus)}</span></button><button className="btn data-button" onClick={() => setStorage(true)} disabled={!state}><Icon name="folder" size={16} />数据管理</button></div></header>
    {!state ? <main className="welcome"><div className="welcome-icon"><Icon name="shield" size={40} /></div><h2>{loadError ? '暂时无法读取账户' : '正在加载 2FAuth…'}</h2>{loadError && <><p className="form-error" role="alert">{loadError}</p><p className="hint">请通过桌面应用使用本地数据功能。</p><button className="btn" onClick={load}>重试</button></>}</main>
      : !state.dataDir ? <main className="welcome"><span className="eyebrow">PRIVATE BY LOCATION · LOCAL BY DESIGN</span><div className="welcome-icon"><Icon name="shield" size={44} /></div><h2>你的账户，多一层守护</h2><p>把验证码与恢复码放在一起。<br />选择一个本地数据目录，开始管理你的双因素认证。</p>{state.startupError && <p className="form-error" role="alert">{state.startupError}</p>}<button className="btn primary" onClick={() => setStorage(true)}><Icon name="folder" size={16} />选择数据目录<Icon name="arrow" size={16} /></button><div className="welcome-features"><span><Icon name="clock" size={17} />离线生成验证码</span><span><Icon name="key" size={17} />集中保存恢复码</span><span><Icon name="folder" size={17} />数据由你掌握</span></div><p className="hint">本地明文存储 · 无云端同步</p></main>
        : <main className="workspace"><aside className="accounts-pane"><div className="pane-head"><div><span className="eyebrow">ACCOUNTS</span><h2>认证账户<span className="count">{state.accounts.length}</span></h2></div><button className="icon-btn add-button" title="添加账户" aria-label="添加账户" onClick={() => setForm('new')}><Icon name="plus" size={20} /></button></div><div className="list-tools"><div className="search-box"><Icon name="search" size={16} /><input ref={search} aria-label="搜索账户" value={query} onChange={e => setQuery(e.target.value)} placeholder="搜索平台、账户…" /><kbd>Ctrl K</kbd></div><div className="filter-row"><div className="segmented"><button className={!favorites ? 'active' : ''} onClick={() => setFavorites(false)}>全部</button><button className={favorites ? 'active' : ''} onClick={() => setFavorites(true)}><Icon name="star" size={12} />收藏</button></div><select className="group-select" aria-label="筛选分组" value={group} onChange={e => setGroup(e.target.value)}><option value="">全部分组</option>{groups.map(g => <option key={g} value={g}>{g}</option>)}</select></div></div>
          <div className="accounts-list">{accounts.length ? accounts.map(a => <button key={a.id} className={`account-row ${a.id === current?.id ? 'active' : ''}`} style={{ '--account-color': a.color } as CSSProperties} aria-pressed={a.id === current?.id} aria-label={`选择 ${a.issuer} ${a.account}`} onClick={() => setSelected(a.id)}><div className="avatar">{a.issuer.slice(0, 2)}</div><div className="account-copy"><strong>{a.issuer}{a.favorite && <Icon name="star" size={11} />}</strong><small>{a.account}</small></div><span className="account-group">{a.group || 'TOTP'}</span></button>) : <div className="list-empty"><Icon name="search" size={25} /><p>{state.accounts.length ? '没有匹配的账户' : '还没有认证账户'}</p>{state.accounts.length ? <button className="text-btn" onClick={() => { setQuery(''); setGroup(''); setFavorites(false) }}>清除筛选</button> : <button className="text-btn" onClick={() => setForm('new')}>添加第一个账户</button>}</div>}</div>
          <div className="add-account-footer"><button onClick={() => setForm('new')}><Icon name="plus" size={16} />添加认证账户<Icon name="qr" size={16} /></button></div><footer className="accounts-footer"><i className="status-dot" /><span>已连接本地数据目录</span><Icon name="folder" size={13} /></footer></aside>
          {current ? <AccountDetail key={`${state.dataDir}:${current.id}:${current.algorithm}:${current.period}:${current.digits}`} account={current} timeStatus={timeStatus} onTimeStatus={acceptTime} onChange={changeState} onEdit={() => setForm(current)} notify={notify} /> : <section className="detail-pane empty-detail"><div className="welcome-icon"><Icon name="shield" size={42} /></div><h2>{state.accounts.length ? '选择一个认证账户' : '从你的第一个账户开始'}</h2><p>{state.accounts.length ? '调整左侧筛选，查看账户的动态验证码。' : '输入 GitHub 等平台的共享密钥，或导入认证二维码。'}</p>{!state.accounts.length && <button className="btn primary" onClick={() => setForm('new')}><Icon name="plus" size={16} />添加账户</button>}<div className="empty-steps"><span><b>01</b>开启平台双因素认证</span><span><b>02</b>添加密钥或二维码</span><span><b>03</b>保存平台恢复码</span></div></section>}
        </main>}
    <footer className="app-footer"><span>2FAuth <small>v0.1.0</small></span><span>TOTP · RFC 6238</span></footer>
    {form && state && <AccountForm account={form === 'new' ? undefined : form} groups={groups} onClose={() => setForm(null)} onSave={(next, id) => { changeState(next); setSelected(id); setQuery(''); setGroup(''); setFavorites(false); setForm(null); notify('账户已保存') }} />}
    {storage && state && <StorageModal state={state} onChange={changeState} onClose={() => setStorage(false)} notify={notify} />}
    {timeModal && <TimeModal status={timeStatus} onChange={acceptTime} onClose={() => setTimeModal(false)} />}
    {toast && <div role={toast.error ? 'alert' : 'status'} className={`toast ${toast.error ? 'error' : ''}`}><Icon name={toast.error ? 'info' : 'check'} size={16} />{toast.message}</div>}
  </div>
}
