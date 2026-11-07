import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { api } from './api'
import { matchesAccount, sortAccounts } from './search'
import type { Account, AppState, ContactLookup } from './types'
import Icon from './components/Icon'
import AccountForm from './components/AccountForm'
import AccountDetail from './components/AccountDetail'
import RelatedModal from './components/RelatedModal'
import StorageModal from './components/StorageModal'

export default function App() {
  const [state, setState] = useState<AppState | null>(null); const [loadError, setLoadError] = useState('')
  const [selected, setSelected] = useState(''); const [query, setQuery] = useState(''); const [platform, setPlatform] = useState(''); const [group, setGroup] = useState('')
  const [favorites, setFavorites] = useState(false); const [storage, setStorage] = useState(false)
  const [lookup, setLookup] = useState<ContactLookup | true | null>(null); const [form, setForm] = useState<Account | 'new' | null>(null)
  const [copying, setCopying] = useState(''); const [toast, setToast] = useState<{ message: string; error: boolean } | null>(null)
  const toastTimer = useRef<number>(); const search = useRef<HTMLInputElement>(null)
  const notify = (message: string, error = false) => { setToast({ message, error }); window.clearTimeout(toastTimer.current); toastTimer.current = window.setTimeout(() => setToast(null), error ? 6500 : 3000) }
  const load = () => { setLoadError(''); api.state().then(setState).catch(e => setLoadError(String(e))) }
  useEffect(() => { load(); return () => window.clearTimeout(toastTimer.current) }, [])
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k' && !form && !storage && !lookup) { e.preventDefault(); search.current?.focus() } }
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key)
  }, [form, storage, lookup])
  const groups = useMemo(() => [...new Set(state?.accounts.map(a => a.group).filter(Boolean) ?? [])].sort(), [state])
  const platforms = useMemo(() => [...new Set(state?.accounts.map(a => a.platform) ?? [])].sort(), [state])
  const accounts = useMemo(() => (state?.accounts ?? []).filter(a => (!favorites || a.favorite) && (!group || a.group === group) && matchesAccount(a, query, platform)).sort(sortAccounts), [state, favorites, group, query, platform])
  const current = accounts.find(a => a.id === selected) ?? accounts[0]
  const clearFilters = () => { setQuery(''); setPlatform(''); setGroup(''); setFavorites(false) }
  const changeState = (next: AppState) => {
    if (next.dataDir !== state?.dataDir) { setSelected(''); clearFilters(); setLookup(null); setForm(null) }
    else if (group && !next.accounts.some(a => a.group === group)) setGroup('')
    setState(next)
  }
  async function quickCopy(a: Account) {
    if (copying) return; setCopying(a.id)
    try { await api.copyPassword(a.id); notify(`${a.platform} 的密码已复制`) } catch (e) { notify(String(e), true) } finally { setCopying('') }
  }
  return <div className="app">
    <header className="topbar"><div className="brand"><div className="logo"><Icon name="book" size={24} /></div><div><h1>DeskAuth</h1><span className="brand-note">YOUR LOCAL ACCOUNT BOOK</span></div></div><div className="topbar-context"><Icon name="user" size={15} /><span>账户资料</span></div><div className="topbar-right"><span className="offline"><i className="status-dot" />本地保存</span><button className="btn" disabled={!state?.dataDir} onClick={() => setLookup(true)}><Icon name="link" size={15} />关联查询</button><button className="btn data-button" disabled={!state} onClick={() => setStorage(true)}><Icon name="folder" size={16} />数据管理</button></div></header>
    {!state ? <main className="welcome"><div className="welcome-icon"><Icon name="book" size={40} /></div><h2>{loadError ? '暂时无法读取账户' : '正在加载 DeskAuth…'}</h2>{loadError && <><p className="form-error" role="alert">{loadError}</p><p className="hint">请通过桌面应用使用本地数据功能。</p><button className="btn" onClick={load}>重试</button></>}</main>
      : !state.dataDir ? <main className="welcome"><span className="eyebrow">YOUR ACCOUNTS · ALL IN ONE PLACE</span><div className="welcome-icon"><Icon name="book" size={44} /></div><h2>你的账户资料，井然有序</h2><p>用户名、密码和关联联系方式，一处保存。<br />选择一个本地数据目录，开始整理你的平台账户。</p>{state.startupError && <p className="form-error" role="alert">{state.startupError}</p>}<button className="btn primary" onClick={() => setStorage(true)}><Icon name="folder" size={16} />选择数据目录<Icon name="arrow" size={16} /></button><div className="welcome-features"><span><Icon name="key" size={17} />密码快速复制</span><span><Icon name="link" size={17} />联系方式关联查询</span><span><Icon name="folder" size={17} />本地可读存储</span></div><p className="hint">明文 JSON · 自选目录 · 无云端同步</p></main>
      : <main className="workspace"><aside className="accounts-pane"><div className="pane-head"><div><span className="eyebrow">ACCOUNTS</span><h2>平台账户<span className="count">{state.accounts.length}</span></h2></div><button className="icon-btn add-button" aria-label="添加账户" onClick={() => setForm('new')}><Icon name="plus" size={20} /></button></div>
        <div className="list-tools"><div className="search-box"><Icon name="search" size={16} /><input ref={search} aria-label="搜索账户" value={query} onChange={e => setQuery(e.target.value)} placeholder="用户名、手机号、邮箱…" />{query ? <button className="icon-btn" aria-label="清除账户搜索" onClick={() => setQuery('')}><Icon name="close" size={12} /></button> : <kbd>Ctrl K</kbd>}</div><div className="search-box platform-search"><Icon name="grid" size={15} /><input aria-label="检索平台" list="filter-platforms" value={platform} onChange={e => setPlatform(e.target.value)} placeholder="检索平台，例如 GitHub" />{platform && <button className="icon-btn" aria-label="清除平台检索" onClick={() => setPlatform('')}><Icon name="close" size={12} /></button>}</div><datalist id="filter-platforms">{platforms.map(p => <option key={p} value={p} />)}</datalist>
          <div className="filter-row"><div className="segmented"><button className={!favorites ? 'active' : ''} onClick={() => setFavorites(false)}>全部</button><button className={favorites ? 'active' : ''} onClick={() => setFavorites(true)}><Icon name="star" size={12} />收藏</button></div><select className="group-select" aria-label="筛选分组" value={group} onChange={e => setGroup(e.target.value)}><option value="">全部分组</option>{groups.map(g => <option key={g} value={g}>{g}</option>)}</select></div><div className="filter-summary"><span>{accounts.length} 个账户{accounts.length !== state.accounts.length && ` / 共 ${state.accounts.length} 个`}</span>{(query || platform || group || favorites) && <button className="text-btn" onClick={clearFilters}>重置筛选</button>}</div></div>
        <div className="accounts-list">{accounts.length ? accounts.map(a => <div key={a.id} className={`account-row ${a.id === current?.id ? 'active' : ''}`} style={{ '--account-color': a.color } as CSSProperties}><button className="account-select" aria-pressed={a.id === current?.id} aria-label={`选择 ${a.platform} ${a.username} ${a.alias}`} onClick={() => setSelected(a.id)}><div className="avatar">{a.platform.slice(0, 2)}</div><div className="account-copy"><strong>{a.platform}{a.favorite && <Icon name="star" size={11} />}</strong><small>{a.alias ? `${a.alias} · ` : ''}{a.username}</small><span className="account-row-meta">{a.group || '未分组'}<span>{a.phones.length > 0 && <><Icon name="phone" size={10} />{a.phones.length}</>}{a.emails.length > 0 && <><Icon name="mail" size={10} />{a.emails.length}</>}</span></span></div></button><button className="icon-btn quick-copy" disabled={!a.hasPassword || !!copying} aria-label={`快速复制密码 ${a.platform} ${a.username} ${a.alias}`} title={a.hasPassword ? '快速复制密码' : '尚未记录密码'} onClick={() => quickCopy(a)}><Icon name={copying === a.id ? 'clock' : 'copy'} size={14} /></button></div>) : <div className="list-empty"><Icon name="search" size={25} /><p>{state.accounts.length ? '没有匹配的账户' : '还没有平台账户'}</p>{state.accounts.length ? <button className="text-btn" onClick={clearFilters}>清除筛选</button> : <button className="text-btn" onClick={() => setForm('new')}>添加第一个账户</button>}</div>}</div>
        <div className="add-account-footer"><button onClick={() => setForm('new')}><Icon name="plus" size={16} />添加平台账户<Icon name="user" size={16} /></button></div><footer className="accounts-footer"><i className="status-dot" /><span>已连接本地数据目录</span><Icon name="folder" size={13} /></footer></aside>
        {current ? <AccountDetail key={`${state.dataDir}:${current.id}:${current.updatedAt}`} account={current} onChange={changeState} onEdit={() => setForm(current)} onLookup={setLookup} notify={notify} /> : <section className="detail-pane empty-detail"><div className="welcome-icon"><Icon name="book" size={42} /></div><h2>{state.accounts.length ? '选择一个平台账户' : '从你的第一个账户开始'}</h2><p>{state.accounts.length ? '调整左侧筛选，查看账户资料。' : '记录平台登录信息，关联手机号和邮箱。'}</p>{!state.accounts.length && <button className="btn primary" onClick={() => setForm('new')}><Icon name="plus" size={16} />添加账户</button>}<div className="empty-steps"><span><b>01</b>记录平台与登录信息</span><span><b>02</b>关联手机号和邮箱</span><span><b>03</b>快速查询与复制</span></div></section>}
      </main>}
    <footer className="app-footer"><span>DeskAuth <small>v0.1.0</small></span><span>本地账户资料管理</span></footer>
    {form && state && <AccountForm account={form === 'new' ? undefined : form} groups={groups} platforms={platforms} onClose={() => setForm(null)} onSave={(next, id) => { changeState(next); setSelected(id); clearFilters(); setForm(null); notify('账户已保存') }} />}
    {lookup && state && <RelatedModal accounts={state.accounts} initial={lookup === true ? undefined : lookup} onClose={() => setLookup(null)} onSelect={id => { setSelected(id); clearFilters(); setLookup(null) }} />}
    {storage && state && <StorageModal state={state} onChange={changeState} onClose={() => setStorage(false)} notify={notify} />}
    {toast && <div role={toast.error ? 'alert' : 'status'} className={`toast ${toast.error ? 'error' : ''}`}><Icon name={toast.error ? 'info' : 'check'} size={16} />{toast.message}</div>}
  </div>
}
