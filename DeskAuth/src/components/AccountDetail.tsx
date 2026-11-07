import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { api } from '../api'
import { purposes, type Account, type AppState, type ContactKind, type ContactLookup, type Notify, type TimeStatus } from '../types'
import Icon from './Icon'
import Modal from './Modal'
import TotpCard from './TotpCard'

const timestamp = (value: number | null) => value === null ? '暂无' : new Date(value).toLocaleString('zh-CN', { hour12: false })

export default function AccountDetail({ account, onChange, onEdit, onLookup, onConfigureTotp, timeStatus, onTimeStatus, notify }: { account: Account; onChange: (state: AppState) => void; onEdit: () => void; onLookup: (lookup: ContactLookup) => void; onConfigureTotp: () => void; timeStatus: TimeStatus | null; onTimeStatus: (status: TimeStatus) => void; notify: Notify }) {
  const [password, setPassword] = useState<string | null>(null); const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false); const [deleting, setDeleting] = useState(false); const [error, setError] = useState('')
  const alive = useRef(true); const version = useRef(0); const copiedTimer = useRef<number>()
  useEffect(() => { version.current++; setPassword(null) }, [account])
  useEffect(() => {
    alive.current = true
    const hide = () => { version.current++; setPassword(null) }
    window.addEventListener('blur', hide); document.addEventListener('visibilitychange', hide)
    return () => { alive.current = false; version.current++; window.clearTimeout(copiedTimer.current); window.removeEventListener('blur', hide); document.removeEventListener('visibilitychange', hide) }
  }, [])
  async function act(task: () => Promise<void>) {
    if (busy) return; setBusy(true)
    try { await task() } catch (e) { if (alive.current) notify(String(e), true) } finally { if (alive.current) setBusy(false) }
  }
  async function togglePassword() {
    if (password !== null) { version.current++; setPassword(null); return }
    await act(async () => { const request = version.current; const value = await api.password(account.id); if (alive.current && request === version.current && !document.hidden) setPassword(value) })
  }
  async function copyPassword() {
    await act(async () => { await api.copyPassword(account.id); if (alive.current) { setCopied(true); window.clearTimeout(copiedTimer.current); copiedTimer.current = window.setTimeout(() => setCopied(false), 1800) } })
  }
  function contacts(kind: ContactKind) {
    const name = kind === 'phones' ? '手机号' : '邮箱'
    const items = [...account[kind]].sort((a, b) => Number(b.primary) - Number(a.primary))
    return <section className="contact-section" aria-label={`关联${name}`}><div className="section-heading"><strong><Icon name={kind === 'phones' ? 'phone' : 'mail'} size={16} />关联{name}<span className="count">{items.length}</span></strong><button className="text-btn" onClick={onEdit}><Icon name="edit" size={13} />管理</button></div>
      {items.length ? <div className="contact-list">{items.map((c, i) => <div className="contact-card" key={c.id}><div className="contact-card-main"><div><div className="contact-card-value"><span className="mono selectable">{c.value}</span>{c.primary && <span className="primary-badge">主要</span>}</div><div className="contact-card-labels">{c.label && <span>{c.label}</span>}{c.purposes.map(p => <span className="purpose-badge" key={p}>{purposes.find(item => item.value === p)?.label}</span>)}</div></div><button className="icon-btn" disabled={busy} title={`复制${name}`} aria-label={`复制${name} ${i + 1}`} onClick={() => act(async () => { await api.copy(c.value); notify(`${name}已复制`) })}><Icon name="copy" size={15} /></button><button className="icon-btn" title="查询关联账户" aria-label={`查询${name}关联 ${i + 1}`} onClick={() => onLookup({ kind, value: c.value })}><Icon name="link" size={15} /></button></div>{c.notes && <p className="contact-card-notes selectable">{c.notes}</p>}</div>)}</div> : <div className="contact-empty"><Icon name={kind === 'phones' ? 'phone' : 'mail'} size={22} /><span>尚未关联{name}</span><button className="text-btn" onClick={onEdit}>添加{name}</button></div>}
    </section>
  }
  return <section className="detail-pane" aria-label="账户详情" style={{ '--account-color': account.color } as CSSProperties}>
    <header className="detail-header"><div className="avatar large">{account.platform.slice(0, 2)}</div><div className="detail-title"><div className="eyebrow">ACCOUNT PROFILE</div><h2>{account.platform}{account.group && <span className="tag">{account.group}</span>}</h2><p className="selectable">{account.alias || account.username}</p></div><button className={`icon-btn ${account.favorite ? 'favorited' : ''}`} aria-label={account.favorite ? '取消收藏' : '收藏账户'} disabled={busy} onClick={() => act(async () => onChange(await api.favorite(account.id, !account.favorite)))}><Icon name="star" /></button><button className="btn" onClick={onEdit}><Icon name="edit" size={14} />编辑</button></header>
    <div className="detail-scroll">
      <section className="credentials-card" aria-label="登录信息"><div className="section-heading"><strong><Icon name="key" size={15} />登录信息</strong>{account.website && <button className="text-btn website-button" disabled={busy} onClick={() => act(() => api.openWebsite(account.id))}>打开网站<Icon name="external" size={13} /></button>}</div>
        <div className="credential-row"><div className="credential-label">用户名</div><span className="credential-value mono selectable">{account.username}</span><button className="icon-btn" disabled={busy} aria-label="复制用户名" onClick={() => act(async () => { await api.copy(account.username); notify('用户名已复制') })}><Icon name="copy" size={16} /></button></div>
        <div className="credential-divider" />
        <div className="credential-row password-row"><div className="credential-label">密码</div><span data-testid="password-value" className={`credential-value password-value mono selectable ${password === null ? 'masked' : ''}`}>{account.hasPassword ? password ?? '••••••••••••' : '尚未记录'}</span><button className="icon-btn" disabled={busy || !account.hasPassword} aria-label={password === null ? '显示密码' : '隐藏密码'} onClick={togglePassword}><Icon name={password === null ? 'eye' : 'hide'} size={16} /></button></div>
        <div className="credential-actions"><span><i className="status-dot" />{account.hasPassword ? '本机保存 · 随时取用' : '可在编辑中补充密码'}</span><button className={`btn ${copied ? 'copied' : 'primary'}`} disabled={busy || !account.hasPassword} onClick={copyPassword}><Icon name={copied ? 'check' : 'copy'} size={15} />{copied ? '已复制' : '复制密码'}</button></div>
      </section>
      <TotpCard id={account.id} config={account.totp ?? null} timeStatus={timeStatus} onTimeStatus={onTimeStatus} onConfigure={onConfigureTotp} notify={notify} />
      {account.website && <div className="website-line"><Icon name="link" size={13} /><span className="selectable">{account.website}</span></div>}
      {account.tags.length > 0 && <div className="account-tags">{account.tags.map(t => <span className="tag" key={t}># {t}</span>)}</div>}
      <div className="contacts-grid">{contacts('phones')}{contacts('emails')}</div>
      <section className="notes-section"><div className="section-heading"><strong><Icon name="book" size={15} />账户备注</strong></div><p className="notes selectable">{account.notes || '暂无备注'}</p></section>
      <dl className="account-timestamps"><dt>创建时间</dt><dd>{timestamp(account.createdAt)}</dd><dt>最近更新</dt><dd>{timestamp(account.updatedAt)}</dd><dt>密码更新</dt><dd>{account.hasPassword ? timestamp(account.passwordUpdatedAt) : '尚未记录'}</dd></dl>
      <div className="danger-zone"><span>移除此账户及其关联资料</span><button className="text-btn danger" onClick={() => { setDeleting(true); setError('') }}><Icon name="trash" size={14} />删除账户</button></div>
    </div><footer className="detail-footer"><Icon name="info" size={13} /><span>资料保存在本地；点击联系方式旁的关联图标，可反查使用它的账户。</span></footer>
    {deleting && <Modal title="删除账户" onClose={() => setDeleting(false)} busy={busy}><p className="confirm-message">确定删除 <strong>{account.platform} · {account.username}</strong>？此账户的本地密码、手机号和邮箱记录会一并移除，平台上的账户不受影响。</p>{error && <p className="form-error" role="alert">{error}</p>}<div className="modal-actions"><button className="btn" disabled={busy} onClick={() => setDeleting(false)}>取消</button><button className="btn danger-solid" disabled={busy} onClick={async () => { if (busy) return; setBusy(true); try { const next = await api.delete(account.id); onChange(next); notify('账户已删除') } catch (e) { if (alive.current) setError(String(e)) } finally { if (alive.current) setBusy(false) } }}>确认删除</button></div></Modal>}
  </section>
}
