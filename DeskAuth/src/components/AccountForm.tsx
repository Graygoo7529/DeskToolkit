import { useEffect, useState, type FormEvent } from 'react'
import { api } from '../api'
import { purposes, type Account, type AccountInput, type AppState, type Contact, type ContactKind } from '../types'
import Icon from './Icon'
import Modal from './Modal'

const palette = ['#A7B8EF', '#86CDB7', '#DDB18D', '#C7A4DE', '#86C6DC', '#DDA5B5', '#C4CC8C', '#A4BFDA']
const presets = [{ name: 'GitHub', url: 'https://github.com' }, { name: 'Google', url: 'https://www.google.com' }, { name: 'Microsoft', url: 'https://www.microsoft.com' }]

function ContactEditor({ kind, items, onChange }: { kind: ContactKind; items: Contact[]; onChange: (items: Contact[]) => void }) {
  const name = kind === 'phones' ? '手机号' : '邮箱'
  const update = (index: number, patch: Partial<Contact>) => onChange(items.map((c, i) => i === index ? { ...c, ...patch } : patch.primary ? { ...c, primary: false } : c))
  return <section className="contact-editor" aria-label={`${name}管理`}>
    <div className="section-heading"><strong><Icon name={kind === 'phones' ? 'phone' : 'mail'} size={15} />关联{name}<span className="count">{items.length}</span></strong><button type="button" className="text-btn" disabled={items.length >= 50} onClick={() => onChange([...items, { id: crypto.randomUUID(), value: '', label: '', purposes: ['verify'], primary: items.length === 0, notes: '' }])}><Icon name="plus" size={14} />添加{name}</button></div>
    {!items.length && <p className="hint">可添加多个{name}，分别记录登录、验证或找回用途。</p>}
    {items.map((c, index) => <div className="contact-edit-card" key={c.id}>
      <div className="contact-edit-head"><span>{name} {String(index + 1).padStart(2, '0')}</span><label className="check-label"><input type="checkbox" checked={c.primary} onChange={e => update(index, { primary: e.target.checked })} />主要{name}</label><button type="button" className="icon-btn danger" aria-label={`移除${name} ${index + 1}`} onClick={() => onChange(items.filter((_, i) => i !== index))}><Icon name="trash" size={14} /></button></div>
      <div className="contact-value-grid"><label className="field"><span>{name}</span><input aria-label={`${name} ${index + 1}`} type={kind === 'phones' ? 'tel' : 'email'} autoComplete="off" spellCheck={false} required maxLength={320} value={c.value} onChange={e => update(index, { value: e.target.value })} placeholder={kind === 'phones' ? '+86 138 0000 0000' : 'name@example.com'} /></label><label className="field"><span>标签</span><input aria-label={`${name}标签 ${index + 1}`} value={c.label} maxLength={40} onChange={e => update(index, { label: e.target.value })} placeholder="个人 / 工作" /></label></div>
      <div className="contact-purposes"><span>用途</span>{purposes.map(p => <label className="check-label" key={p.value}><input type="checkbox" checked={c.purposes.includes(p.value)} onChange={e => update(index, { purposes: e.target.checked ? [...c.purposes, p.value] : c.purposes.filter(v => v !== p.value) })} />{p.label}</label>)}</div>
      <label className="field contact-note"><span className="sr-only">{name}备注 {index + 1}</span><input value={c.notes} maxLength={1000} onChange={e => update(index, { notes: e.target.value })} placeholder="补充备注（可选）" /></label>
    </div>)}
  </section>
}

export default function AccountForm({ account, groups, platforms, onClose, onSave }: { account?: Account; groups: string[]; platforms: string[]; onClose: () => void; onSave: (state: AppState, id: string) => void }) {
  const [form, setForm] = useState<AccountInput>({ id: account?.id ?? null, platform: account?.platform ?? '', website: account?.website ?? '', alias: account?.alias ?? '', username: account?.username ?? '', password: '', phones: account?.phones.map(c => ({ ...c, purposes: [...c.purposes] })) ?? [], emails: account?.emails.map(c => ({ ...c, purposes: [...c.purposes] })) ?? [], group: account?.group ?? '', tags: account?.tags ?? [], color: account?.color ?? palette[0], notes: account?.notes ?? '' })
  const [tagText, setTagText] = useState(account?.tags.join('，') ?? '')
  const [passwordMode, setPasswordMode] = useState<'keep' | 'replace' | 'clear'>(account ? 'keep' : 'replace')
  const [visible, setVisible] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState('')
  useEffect(() => { const hide = () => setVisible(false); window.addEventListener('blur', hide); return () => window.removeEventListener('blur', hide) }, [])
  const set = <K extends keyof AccountInput>(key: K, value: AccountInput[K]) => setForm(prev => ({ ...prev, [key]: value }))
  async function submit(e: FormEvent) {
    e.preventDefault(); if (busy) return; setBusy(true); setError('')
    try {
      const tags = [...new Set(tagText.split(/[,，\n]/).map(t => t.trim()).filter(Boolean))]
      const result = await api.save({ ...form, tags, password: passwordMode === 'keep' ? null : passwordMode === 'clear' ? '' : form.password })
      onSave(result.state, result.id)
    } catch (e) { setError(String(e)) } finally { setBusy(false) }
  }
  return <Modal title={account ? '编辑账户' : '添加账户'} onClose={onClose} busy={busy} wide>
    <form onSubmit={submit} autoComplete="off"><fieldset disabled={busy}>
      {!account && <div className="presets">{presets.map(p => <button type="button" key={p.name} className={form.platform === p.name ? 'selected' : ''} onClick={() => setForm(prev => ({ ...prev, platform: p.name, website: prev.website || p.url }))}>{p.name}</button>)}<span>或填写任意平台</span></div>}
      <div className="field-grid"><label className="field"><span>平台 <small>必填</small></span><input data-autofocus required maxLength={120} list="platform-suggestions" value={form.platform} onChange={e => set('platform', e.target.value)} placeholder="例如 GitHub" /></label><label className="field"><span>账户别名</span><input maxLength={120} value={form.alias} onChange={e => set('alias', e.target.value)} placeholder="例如 个人 / 工作账户" /></label></div>
      <datalist id="platform-suggestions">{[...new Set([...platforms, ...presets.map(p => p.name)])].map(p => <option key={p} value={p} />)}</datalist>
      <label className="field"><span>平台主页</span><input type="url" maxLength={2048} value={form.website} onChange={e => set('website', e.target.value)} placeholder="https://example.com" /></label>
      <label className="field"><span>用户名 <small>必填，可填写登录手机号或邮箱</small></span><input required maxLength={320} value={form.username} spellCheck={false} onChange={e => set('username', e.target.value)} placeholder="平台用户名 / 登录标识" /></label>
      <div className="field"><span>密码{!account && <small>可稍后填写</small>}</span>
        {account && <div className="segmented password-modes" aria-label="密码处理方式">{([{ value: 'keep', label: '保留原密码' }, { value: 'replace', label: '更换密码' }, { value: 'clear', label: '清空密码' }] as const).map(m => <button type="button" key={m.value} aria-pressed={passwordMode === m.value} className={passwordMode === m.value ? 'active' : ''} onClick={() => { setPasswordMode(m.value); setVisible(false) }}>{m.label}</button>)}</div>}
        {passwordMode === 'replace' && <div className="input-action"><input aria-label="新密码" autoComplete="new-password" spellCheck={false} type={visible ? 'text' : 'password'} value={form.password ?? ''} onChange={e => set('password', e.target.value)} placeholder="按原样保存，保留首尾空格" /><button type="button" className="icon-btn" aria-label={visible ? '隐藏输入密码' : '显示输入密码'} onClick={() => setVisible(!visible)}><Icon name={visible ? 'hide' : 'eye'} size={16} /></button></div>}
        {passwordMode === 'clear' && <p className="hint">保存后将清空此账户的本地密码记录。</p>}
      </div>
      <ContactEditor kind="phones" items={form.phones} onChange={value => set('phones', value)} />
      <ContactEditor kind="emails" items={form.emails} onChange={value => set('emails', value)} />
      <div className="field-grid"><label className="field"><span>分组</span><input list="group-suggestions" maxLength={60} value={form.group} onChange={e => set('group', e.target.value)} placeholder="个人 / 工作 / 开发" /><datalist id="group-suggestions">{groups.map(g => <option key={g} value={g} />)}</datalist></label><label className="field"><span>标签 <small>用逗号分隔</small></span><input value={tagText} onChange={e => setTagText(e.target.value)} placeholder="常用，工作" /></label></div>
      <label className="field"><span>备注</span><textarea rows={3} maxLength={10000} value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="其他账户信息、使用说明…" /></label>
      <div className="field"><span>标识颜色</span><div className="colors">{palette.map(c => <button type="button" key={c} aria-label={`颜色 ${c}`} aria-pressed={form.color === c} className={form.color === c ? 'selected' : ''} style={{ background: c }} onClick={() => set('color', c)}>{form.color === c && <Icon name="check" size={12} />}</button>)}</div></div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="modal-actions"><button type="button" className="btn" onClick={onClose}>取消</button><button className="btn primary" type="submit">{busy ? '保存中…' : '保存账户'}</button></div>
    </fieldset></form>
  </Modal>
}
