import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { api } from './api'
import { accountSorts, compareAccounts, matchesAccount, type AccountSort } from './search'
import type { Account, AppState, ContactLookup, TimeStatus } from './types'
import Icon from './components/Icon'
import AccountForm from './components/AccountForm'
import AccountDetail from './components/AccountDetail'
import RelatedModal from './components/RelatedModal'
import StorageModal from './components/StorageModal'
import TotpModal from './components/TotpModal'
import TimeModal from './components/TimeModal'
import { timeLabel } from './clock'

export default function App() {
  const [state, setState] = useState<AppState | null>(null); const [loadError, setLoadError] = useState('')
  const [totpAccount, setTotpAccount] = useState<Account | null>(null)
  const [timeStatus, setTimeStatus] = useState<TimeStatus | null>(null); const [timeModal, setTimeModal] = useState(false)
  const acceptTime = useCallback((next: TimeStatus) => setTimeStatus(previous => previous && previous.revision > next.revision ? previous : next), [])
  const [selected, setSelected] = useState(''); const [query, setQuery] = useState(''); const [platform, setPlatform] = useState(''); const [group, setGroup] = useState('')
  const [searchOpen, setSearchOpen] = useState(false); const [order, setOrder] = useState<AccountSort>('name-asc')
  const [favorites, setFavorites] = useState(false); const [storage, setStorage] = useState(false)
  const [lookup, setLookup] = useState<ContactLookup | true | null>(null); const [form, setForm] = useState<Account | 'new' | null>(null)
  const [copying, setCopying] = useState(''); const [toast, setToast] = useState<{ message: string; error: boolean } | null>(null)
  const toastTimer = useRef<number>(); const search = useRef<HTMLInputElement>(null); const searchToggle = useRef<HTMLButtonElement>(null)
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
    const key = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k' && !form && !storage && !lookup && !totpAccount && !timeModal) { e.preventDefault(); setSearchOpen(true); search.current?.focus() } }
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key)
  }, [form, storage, lookup, totpAccount, timeModal])
  useEffect(() => { if (searchOpen) search.current?.focus() }, [searchOpen])
  const closeSearch = () => { setQuery(''); setSearchOpen(false); searchToggle.current?.focus() }
  const groups = useMemo(() => [...new Set(state?.accounts.map(a => a.group).filter(Boolean) ?? [])].sort(), [state])
  const platforms = useMemo(() => [...new Set(state?.accounts.map(a => a.platform) ?? [])].sort(), [state])
  const accounts = useMemo(() => (state?.accounts ?? []).filter(a => (!favorites || a.favorite) && (!group || a.group === group) && matchesAccount(a, query, platform)).sort((a, b) => compareAccounts(a, b, order)), [state, favorites, group, query, platform, order])
  const current = accounts.find(a => a.id === selected) ?? accounts[0]
  const clearFilters = () => { setQuery(''); setPlatform(''); setGroup(''); setFavorites(false) }
  const changeState = (next: AppState) => {
    if (next.dataDir !== state?.dataDir) { setSelected(''); clearFilters(); setLookup(null); setForm(null); setTotpAccount(null) }
    else if (group && !next.accounts.some(a => a.group === group)) setGroup('')
    setState(next)
  }
  async function quickCopy(a: Account) {
    if (copying) return; setCopying(a.id)
    try { await api.copyPassword(a.id); notify(`${a.platform} 的密码已复制`) } catch (e) { notify(String(e), true) } finally { setCopying('') }
  }
  return <div className="app">
    <header className="topbar">
      <div className="brand"><img className="logo" src="/app-icon.svg" alt="" /><h1>DeskAuth</h1><span className="version">0.4</span></div>
      <div className="topbar-right">
        <button className={`time-button ${timeStatus?.error ? 'warning' : ''}`} aria-label="时间校准" onClick={() => setTimeModal(true)}><Icon name="clock" size={14} /><span>{timeLabel(timeStatus)}</span></button>
        <button className="btn" disabled={!state?.dataDir} onClick={() => setLookup(true)}><Icon name="link" size={15} />关联查询</button>
        <button className="btn data-button" disabled={!state} onClick={() => setStorage(true)}><Icon name="folder" size={16} />数据管理</button>
      </div>
    </header>
    {!state ? <main className="welcome"><div className="welcome-icon"><Icon name="book" size={36} /></div><h2>{loadError ? '暂时无法读取账户' : '正在加载 DeskAuth…'}</h2>{loadError && <><p className="form-error" role="alert">{loadError}</p><button className="btn" onClick={load}>重试</button></>}</main>
      : !state.dataDir ? <main className="welcome"><img className="welcome-logo" src="/app-icon.svg" alt="" /><h2>DeskAuth</h2>{state.startupError && <p className="form-error" role="alert">{state.startupError}</p>}<button className="btn primary" onClick={() => setStorage(true)}><Icon name="folder" size={16} />选择数据目录<Icon name="arrow" size={16} /></button></main>
      : <main className="workspace">
        <aside className="accounts-pane" aria-label="平台账户列表">
          <div className="pane-head">
            <h2>平台账户<span className="count">{state.accounts.length}</span></h2>
            <div className="pane-actions">
              <button ref={searchToggle} className={`icon-btn ${searchOpen ? 'is-active' : ''}`} aria-label={searchOpen ? '收起账户搜索' : '展开账户搜索'} aria-expanded={searchOpen} aria-controls="account-search" title="搜索账户 · Ctrl+K" onClick={() => searchOpen ? closeSearch() : setSearchOpen(true)}><Icon name="search" size={16} /></button>
              <label className="sort-control" title={`排序：${accountSorts.find(item => item.value === order)?.label}`}><Icon name="sort" size={16} /><select aria-label="账户排序" value={order} onChange={e => { if (current) setSelected(current.id); setOrder(e.target.value as AccountSort) }}>{accountSorts.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
              <button className="icon-btn add-button" aria-label="添加账户" title="添加账户" onClick={() => setForm('new')}><Icon name="plus" size={18} /></button>
            </div>
          </div>
          <div className="list-tools">
            {searchOpen && <div id="account-search" className="search-box account-search"><Icon name="search" size={15} /><input ref={search} aria-label="搜索账户" value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); closeSearch() } }} placeholder="用户名、手机号、邮箱…" />{query ? <button className="icon-btn" aria-label="清除账户搜索" onClick={() => { setQuery(''); search.current?.focus() }}><Icon name="close" size={12} /></button> : <kbd>Esc</kbd>}</div>}
            <div className="search-box platform-search"><Icon name="grid" size={15} /><input aria-label="检索平台" list="filter-platforms" value={platform} onChange={e => setPlatform(e.target.value)} placeholder="检索平台" />{platform && <button className="icon-btn" aria-label="清除平台检索" onClick={() => setPlatform('')}><Icon name="close" size={12} /></button>}</div>
            <datalist id="filter-platforms">{platforms.map(p => <option key={p} value={p} />)}</datalist>
            <div className="filter-row"><div className="segmented"><button aria-pressed={!favorites} className={!favorites ? 'active' : ''} onClick={() => setFavorites(false)}>全部</button><button aria-pressed={favorites} className={favorites ? 'active' : ''} onClick={() => setFavorites(true)}><Icon name="star" size={12} />收藏</button></div><select className="group-select" aria-label="筛选分组" value={group} onChange={e => setGroup(e.target.value)}><option value="">全部分组</option>{groups.map(g => <option key={g} value={g}>{g}</option>)}</select></div>
            {(query || platform || group || favorites) && <div className="filter-summary"><span>{accounts.length} / {state.accounts.length} 个账户</span><button className="text-btn" onClick={clearFilters}>重置筛选</button></div>}
          </div>
          <div className="accounts-list">{accounts.length ? accounts.map(a => <div key={a.id} className={`account-row ${a.id === current?.id ? 'active' : ''}`} style={{ '--account-color': a.color } as CSSProperties}><button className="account-select" aria-pressed={a.id === current?.id} aria-label={`选择 ${a.platform} ${a.username} ${a.alias}`} onClick={() => setSelected(a.id)}><div className="avatar">{a.platform.slice(0, 2)}</div><div className="account-copy"><strong>{a.platform}{a.favorite && <Icon name="star" size={11} />}</strong><small>{a.alias ? `${a.alias} · ` : ''}{a.username}</small><span className="account-row-meta">{a.group || '未分组'}<span>{a.phones.length > 0 && <><Icon name="phone" size={10} />{a.phones.length}</>}{a.emails.length > 0 && <><Icon name="mail" size={10} />{a.emails.length}</>}</span></span></div></button><button className="icon-btn quick-copy" disabled={!a.hasPassword || !!copying} aria-label={`快速复制密码 ${a.platform} ${a.username} ${a.alias}`} title={a.hasPassword ? '快速复制密码' : '尚未记录密码'} onClick={() => quickCopy(a)}><Icon name={copying === a.id ? 'clock' : 'copy'} size={14} /></button></div>) : <div className="list-empty"><Icon name="search" size={25} /><p>{state.accounts.length ? '没有匹配的账户' : '还没有平台账户'}</p>{state.accounts.length ? <button className="text-btn" onClick={clearFilters}>清除筛选</button> : <button className="text-btn" onClick={() => setForm('new')}>添加第一个账户</button>}</div>}</div>
        </aside>
        {current ? <AccountDetail key={`${state.dataDir}:${current.id}:${current.updatedAt}`} account={current} timeStatus={timeStatus} onTimeStatus={acceptTime} onConfigureTotp={() => setTotpAccount(current)} onChange={changeState} onEdit={() => setForm(current)} onLookup={setLookup} notify={notify} /> : <section className="detail-pane empty-detail"><div className="welcome-icon"><Icon name="book" size={36} /></div><h2>{state.accounts.length ? '暂无可显示的账户' : '添加你的第一个账户'}</h2>{!state.accounts.length && <button className="btn primary" onClick={() => setForm('new')}><Icon name="plus" size={16} />添加账户</button>}</section>}
      </main>}
    {form && state && <AccountForm account={form === 'new' ? undefined : form} groups={groups} platforms={platforms} onClose={() => setForm(null)} onSave={(next, id) => { changeState(next); setSelected(id); clearFilters(); setForm(null); notify('账户已保存') }} />}
    {lookup && state && <RelatedModal accounts={state.accounts} initial={lookup === true ? undefined : lookup} onClose={() => setLookup(null)} onSelect={id => { setSelected(id); clearFilters(); setLookup(null) }} />}
    {storage && state && <StorageModal state={state} onChange={changeState} onClose={() => setStorage(false)} notify={notify} />}
    {totpAccount && <TotpModal account={totpAccount} onClose={() => setTotpAccount(null)} onSave={next => { changeState(next); setTotpAccount(null) }} />}
    {timeModal && <TimeModal status={timeStatus} onChange={acceptTime} onClose={() => setTimeModal(false)} />}
    {toast && <div role={toast.error ? 'alert' : 'status'} className={`toast ${toast.error ? 'error' : ''}`}><Icon name={toast.error ? 'info' : 'check'} size={16} />{toast.message}</div>}
  </div>
}
