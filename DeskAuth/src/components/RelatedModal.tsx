import { useMemo, useState, type CSSProperties } from 'react'
import { contactIndex, contactKey, matchesContact } from '../search'
import type { Account, ContactKind, ContactLookup } from '../types'
import Modal from './Modal'
import Icon from './Icon'

export default function RelatedModal({ accounts, initial, onSelect, onClose }: { accounts: Account[]; initial?: ContactLookup; onSelect: (id: string) => void; onClose: () => void }) {
  const [kind, setKind] = useState<ContactKind>(initial?.kind ?? 'phones')
  const [query, setQuery] = useState(initial?.value ?? '')
  const [selected, setSelected] = useState(initial ? contactKey(initial.value, initial.kind) : '')
  const index = useMemo(() => contactIndex(accounts, kind), [accounts, kind])
  const filtered = index.filter(g => matchesContact(g, query, kind))
  const current = filtered.find(g => g.key === selected) ?? filtered[0]
  return <Modal title="联系方式关联查询" onClose={onClose} wide>
    <p className="hint lookup-intro">查找一个手机号或邮箱，查看它关联的所有平台账户。</p>
    <div className="segmented lookup-tabs"><button className={kind === 'phones' ? 'active' : ''} onClick={() => { setKind('phones'); setQuery(''); setSelected('') }}><Icon name="phone" size={14} />手机号</button><button className={kind === 'emails' ? 'active' : ''} onClick={() => { setKind('emails'); setQuery(''); setSelected('') }}><Icon name="mail" size={14} />邮箱</button></div>
    <div className="search-box lookup-search"><Icon name="search" size={16} /><input data-autofocus aria-label="检索联系方式" value={query} onChange={e => setQuery(e.target.value)} placeholder={kind === 'phones' ? '搜索号码或标签…' : '搜索邮箱或标签…'} />{query && <button className="icon-btn" aria-label="清除联系方式检索" onClick={() => setQuery('')}><Icon name="close" size={13} /></button>}</div>
    <div className="lookup-layout"><div className="lookup-values" aria-label="联系方式列表">{filtered.map(g => <button key={g.key} className={current?.key === g.key ? 'active' : ''} onClick={() => setSelected(g.key)}><span className="mono">{g.value}</span><small>{g.accounts.length} 个账户{g.labels.length > 0 && ` · ${g.labels.join(' / ')}`}</small></button>)}{!filtered.length && <p className="hint lookup-empty">{index.length ? '没有匹配的联系方式' : '尚未记录关联联系方式'}</p>}</div><div className="lookup-accounts" aria-label="关联账户列表">
      {current ? <><div className="section-heading"><strong>关联账户</strong><span>{current.accounts.length} 个</span></div><p className="lookup-current mono selectable">{current.value}</p>{current.accounts.map(a => <button className="lookup-account" key={a.id} aria-label={`查看账户 ${a.platform} ${a.username}`} onClick={() => onSelect(a.id)} style={{ '--account-color': a.color } as CSSProperties}><div className="avatar">{a.platform.slice(0, 2)}</div><div><strong>{a.platform}<small>{a.alias}</small></strong><span>{a.username}</span></div><Icon name="arrow" size={15} /></button>)}</> : <div className="lookup-empty"><Icon name="link" size={27} /><p>选择联系方式，查看关联账户</p></div>}
    </div></div><div className="modal-actions"><button className="btn" onClick={onClose}>关闭</button></div>
  </Modal>
}
