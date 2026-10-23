import { useRef, useState, type FormEvent } from 'react'
import jsQR from 'jsqr'
import { api } from '../api'
import type { Account, AccountInput, AppState, Algorithm } from '../types'
import Modal from './Modal'
import Icon from './Icon'

export const palette = ['#A7B8EF', '#86CDB7', '#DDB18D', '#C7A4DE', '#86C6DC', '#DDA5B5', '#C4CC8C', '#A4BFDA']
const presets = ['GitHub', 'Google', 'Microsoft', 'GitLab', '自定义']

export default function AccountForm({ account, groups, onClose, onSave }: { account?: Account; groups: string[]; onClose: () => void; onSave: (state: AppState, id: string) => void }) {
  const [form, setForm] = useState<AccountInput>({ id: account?.id ?? null, issuer: account?.issuer ?? 'GitHub', account: account?.account ?? '', secret: '', algorithm: account?.algorithm ?? 'SHA1', digits: account?.digits ?? 6, period: account?.period ?? 30, group: account?.group ?? '', color: account?.color ?? palette[0], notes: account?.notes ?? '' })
  const [mode, setMode] = useState<'manual' | 'import'>('manual')
  const [uri, setUri] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false)
  const [visible, setVisible] = useState(false); const [parsed, setParsed] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const set = <K extends keyof AccountInput>(key: K, value: AccountInput[K]) => setForm(prev => ({ ...prev, [key]: value }))
  async function parse(value: string) {
    const result = await api.parse(value)
    setForm(prev => ({ ...prev, ...result, issuer: result.issuer || '自定义' })); setUri(''); setParsed(true); setMode('manual')
  }
  async function readQr(file: File) {
    setBusy(true); setError('')
    try {
      if (file.size > 12 * 1024 * 1024) throw new Error('二维码图片不能超过 12 MB')
      const bitmap = await createImageBitmap(file)
      try {
        const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height))
        const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale))
        const context = canvas.getContext('2d')!
        context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height)
        const qr = jsQR(pixels.data, pixels.width, pixels.height, { inversionAttempts: 'attemptBoth' })
        if (!qr) throw new Error('未识别到二维码，请使用清晰的二维码原图')
        await parse(qr.data)
      } finally { bitmap.close() }
    } catch (e) { setError(String(e)) } finally { setBusy(false) }
  }
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError('')
    try { const result = await api.save({ ...form, secret: form.secret?.trim() || null }); onSave(result.state, result.id) }
    catch (e) { setError(String(e)) } finally { setBusy(false) }
  }
  return <Modal title={account ? '编辑账户' : '添加认证账户'} onClose={onClose} busy={busy} wide>
    <form onSubmit={submit} onPaste={e => {
      const file = Array.from(e.clipboardData.items).find(i => i.type.startsWith('image/'))?.getAsFile()
      if (file && !busy) { e.preventDefault(); void readQr(file) }
    }}>
      <fieldset disabled={busy}>
        {!account && <div className="segmented form-tabs"><button type="button" className={mode === 'manual' ? 'active' : ''} onClick={() => setMode('manual')}><Icon name="key" size={15} />手动输入</button><button type="button" className={mode === 'import' ? 'active' : ''} onClick={() => setMode('import')}><Icon name="qr" size={15} />链接 / 二维码</button></div>}
        {mode === 'import' ? <>
          <label className="field"><span>认证链接</span><textarea data-autofocus autoComplete="off" spellCheck={false} rows={4} value={uri} onChange={e => setUri(e.target.value)} placeholder="otpauth://totp/…" /></label>
          <button type="button" className="btn primary full" disabled={!uri.trim()} onClick={async () => { setBusy(true); setError(''); try { await parse(uri) } catch (e) { setError(String(e)) } finally { setBusy(false) } }}>解析认证链接<Icon name="arrow" size={15} /></button>
          <div className="qr-drop" onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); const file = e.dataTransfer.files[0]; if (file && !busy) void readQr(file) }}>
            <Icon name="qr" size={32} /><strong>拖入或粘贴二维码图片</strong><span>也可以选择本地 PNG、JPG 或 WebP 图片</span>
            <button type="button" className="btn" onClick={() => fileInput.current?.click()}>选择图片</button>
            <input ref={fileInput} type="file" hidden accept="image/png,image/jpeg,image/webp" onChange={e => { const f = e.target.files?.[0]; if (f) void readQr(f); e.target.value = '' }} />
          </div><p className="hint">图片只在本机解析。识别后可核对平台、账户及算法参数，再保存。</p>
        </> : <>
          {parsed && <p className="notice success"><Icon name="check" size={16} />已读取认证信息，请核对后保存。</p>}
          {!account && <div className="presets">{presets.map((name, i) => <button type="button" key={name} className={form.issuer === name ? 'selected' : ''} onClick={() => { setForm(prev => ({ ...prev, issuer: name === '自定义' ? '' : name, color: palette[i], algorithm: 'SHA1', digits: 6, period: 30 })); setParsed(false) }}>{name}</button>)}</div>}
          <div className="field-grid"><label className="field"><span>平台名称</span><input required maxLength={80} value={form.issuer} onChange={e => set('issuer', e.target.value)} placeholder="GitHub" /></label><label className="field"><span>账户名称</span><input data-autofocus required maxLength={120} autoComplete="off" value={form.account} onChange={e => set('account', e.target.value)} placeholder="用户名或邮箱" /></label></div>
          <label className="field"><span>共享密钥 {account && <small>留空保留原密钥</small>}</span><div className="input-action"><input aria-label="共享密钥" required={!account} type={visible ? 'text' : 'password'} autoComplete="off" spellCheck={false} maxLength={2048} value={form.secret ?? ''} onChange={e => set('secret', e.target.value)} placeholder={account ? '已保存 · 输入新密钥以替换' : '输入平台提供的 Base32 密钥'} /><button type="button" className="icon-btn" aria-label={visible ? '隐藏输入密钥' : '显示输入密钥'} onClick={() => setVisible(!visible)}><Icon name={visible ? 'hide' : 'eye'} size={16} /></button></div><small className="hint">在平台开启双因素认证时获取，可包含空格和短横线。</small></label>
          <div className="field-grid three"><label className="field"><span>算法</span><select value={form.algorithm} onChange={e => set('algorithm', e.target.value as Algorithm)}>{['SHA1', 'SHA256', 'SHA512'].map(a => <option key={a} value={a}>{a.replace('SHA', 'SHA-')}</option>)}</select></label><label className="field"><span>验证码位数</span><select value={form.digits} onChange={e => set('digits', Number(e.target.value))}>{[6, 7, 8].map(n => <option key={n} value={n}>{n} 位</option>)}</select></label><label className="field"><span>时间周期（秒）</span><input type="number" min={1} max={300} required value={form.period} onChange={e => set('period', Number(e.target.value))} /></label></div>
          <p className="hint parameter-hint">常用参数为 SHA-1 / 6 位 / 30 秒；请以平台提供的参数为准。</p>
          <div className="field-grid"><label className="field"><span>分组 <small>可选</small></span><input list="account-groups" maxLength={40} value={form.group} onChange={e => set('group', e.target.value)} placeholder="例如：个人、工作" /><datalist id="account-groups">{groups.map(g => <option key={g} value={g} />)}</datalist></label><div className="field"><span>标识颜色</span><div className="colors">{palette.map(c => <button type="button" key={c} className={form.color === c ? 'selected' : ''} style={{ background: c }} aria-label={`颜色 ${c}`} aria-pressed={form.color === c} onClick={() => set('color', c)}>{form.color === c && <Icon name="check" size={14} />}</button>)}</div></div></div>
          <label className="field"><span>备注 <small>可选</small></span><textarea rows={2} maxLength={3000} value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="账户用途、登录提示…" /></label>
          <p className="hint">恢复码可在保存账户后单独管理。</p>
        </>}
      </fieldset>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="modal-actions"><button type="button" className="btn" disabled={busy} onClick={onClose}>取消</button>{mode === 'manual' && <button type="submit" className="btn primary" disabled={busy}>{busy ? '保存中…' : '保存账户'}</button>}</div>
    </form>
  </Modal>
}
