import { useEffect, useRef, useState } from 'react'
import jsQR from 'jsqr'
import { api } from '../api'
import type { Account, AppState, ParsedTotp, TotpInput } from '../types'
import Modal from './Modal'
import Icon from './Icon'

async function decodeQr(file: File): Promise<string> {
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
    return qr.data
  } finally { bitmap.close() }
}

export default function TotpModal({ account, onClose, onSave }: { account: Account; onClose: () => void; onSave: (state: AppState) => void }) {
  const [mode, setMode] = useState<'manual' | 'uri'>('manual')
  const [input, setInput] = useState<TotpInput>({ secret: '', algorithm: account.totp?.algorithm ?? 'SHA1', digits: account.totp?.digits ?? 6, period: account.totp?.period ?? 30 })
  const [uri, setUri] = useState(''); const [parsed, setParsed] = useState<{ issuer: string; account: string } | null>(null)
  const [visible, setVisible] = useState(false); const [savedSecret, setSavedSecret] = useState('')
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [removing, setRemoving] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null); const alive = useRef(true); const version = useRef(0)
  useEffect(() => {
    alive.current = true
    const hide = () => { version.current++; setVisible(false); setSavedSecret('') }
    window.addEventListener('blur', hide); document.addEventListener('visibilitychange', hide)
    return () => { alive.current = false; version.current++; window.removeEventListener('blur', hide); document.removeEventListener('visibilitychange', hide) }
  }, [])
  async function run(task: () => Promise<void>) {
    if (busy) return; setBusy(true); setError('')
    try { await task() } catch (e) { if (alive.current) setError(String(e)) } finally { if (alive.current) setBusy(false) }
  }
  function adopt(value: ParsedTotp) {
    setInput({ secret: value.secret, algorithm: value.algorithm, digits: value.digits, period: value.period })
    setParsed({ issuer: value.issuer, account: value.account }); setMode('manual'); setUri(''); setVisible(false); setSavedSecret('')
  }
  const parse = async (text: string) => adopt(await api.parse(text))
  return <Modal title={account.totp ? '管理认证器' : '配置认证器'} onClose={onClose} busy={busy} wide>
    <p className="totp-target"><Icon name="shield" size={16} /><span>{account.platform} · {account.username}</span></p>
    {removing ? <><p className="confirm-message">移除此账户在 DeskAuth 中保存的认证器？平台上的双因素认证设置不会关闭，账户密码和联系方式会保留。</p><p className="hint">上一版本及手动备份仍可能保留旧密钥。</p>{error && <p className="form-error" role="alert">{error}</p>}<div className="modal-actions"><button className="btn" disabled={busy} onClick={() => setRemoving(false)}>取消</button><button className="btn danger-solid" disabled={busy} onClick={() => run(async () => onSave(await api.removeTotp(account.id)))}>确认移除认证器</button></div></>
      : <form onSubmit={e => { e.preventDefault(); void run(async () => onSave(await api.configureTotp(account.id, { ...input, secret: input.secret?.trim() || null }))) }} onPaste={e => {
        const file = Array.from(e.clipboardData.items).find(i => i.type.startsWith('image/'))?.getAsFile()
        if (file && !busy) { e.preventDefault(); void run(async () => parse(await decodeQr(file))) }
      }}><fieldset disabled={busy}>
        <div className="segmented form-tabs">{([{ id: 'manual', label: '手动配置' }, { id: 'uri', label: '链接 / 二维码' }] as const).map(m => <button type="button" key={m.id} aria-pressed={mode === m.id} className={mode === m.id ? 'active' : ''} onClick={() => { setMode(m.id); setError('') }}>{m.label}</button>)}</div>
        {mode === 'manual' && <>
          {parsed && <div className="notice success"><Icon name="check" size={16} /><span>已读取 {parsed.issuer || '认证器'} · {parsed.account}。请核对此认证信息属于上方账户，保存后生效。</span></div>}
          <label className="field"><span>2FA 原码（共享密钥）<small>{account.totp ? '留空保留原密钥' : 'Base32 格式'}</small></span><div className="input-action"><input data-autofocus aria-label="认证器共享密钥" autoComplete="off" spellCheck={false} type={visible ? 'text' : 'password'} value={input.secret ?? ''} onChange={e => setInput(prev => ({ ...prev, secret: e.target.value }))} placeholder={account.totp ? '留空保留原密钥' : '例如 JBSWY3DPEHPK3PXP'} /><button className="icon-btn" type="button" aria-label={visible ? '隐藏输入密钥' : '显示输入密钥'} onClick={() => setVisible(!visible)}><Icon name={visible ? 'hide' : 'eye'} size={16} /></button></div></label>
          <div className="field-grid three"><label className="field"><span>算法</span><select value={input.algorithm} onChange={e => setInput(prev => ({ ...prev, algorithm: e.target.value as TotpInput['algorithm'] }))}><option value="SHA1">HMAC-SHA-1</option><option value="SHA256">HMAC-SHA-256</option><option value="SHA512">HMAC-SHA-512</option></select></label><label className="field"><span>验证码位数</span><select value={input.digits} onChange={e => setInput(prev => ({ ...prev, digits: Number(e.target.value) }))}>{[6, 7, 8].map(d => <option key={d} value={d}>{d} 位</option>)}</select></label><label className="field"><span>时间周期（秒）</span><input type="number" min={1} max={300} required value={input.period} onChange={e => setInput(prev => ({ ...prev, period: Number(e.target.value) }))} /></label></div>
          {account.totp && <div className="totp-secret-view"><button type="button" className="text-btn" onClick={() => { if (savedSecret) { version.current++; setSavedSecret('') } else void run(async () => { const request = version.current; const value = await api.totpSecret(account.id); if (request === version.current && !document.hidden) setSavedSecret(value) }) }}><Icon name={savedSecret ? 'hide' : 'eye'} size={14} />{savedSecret ? '收起已保存密钥' : '查看已保存密钥'}</button>{savedSecret && <p className="secret-value mono selectable">{savedSecret}</p>}</div>}
        </>}
        {mode === 'uri' && <>
          <label className="field"><span>认证链接</span><textarea rows={3} autoComplete="off" spellCheck={false} value={uri} onChange={e => setUri(e.target.value)} placeholder="otpauth://totp/…" /></label>
          <button type="button" className="btn primary full" disabled={!uri.trim()} onClick={() => run(() => parse(uri))}>解析认证链接<Icon name="arrow" size={14} /></button>
          <div className="qr-drop" onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); const file = e.dataTransfer.files[0]; if (file && !busy) void run(async () => parse(await decodeQr(file))) }}><Icon name="qr" size={30} /><strong>拖入或粘贴二维码图片</strong><span>在本机解析 PNG、JPG 或 WebP 图片</span><button type="button" className="btn" onClick={() => fileInput.current?.click()}>选择二维码图片</button><input ref={fileInput} type="file" aria-label="二维码图片" hidden accept="image/png,image/jpeg,image/webp" onChange={e => { const file = e.target.files?.[0]; if (file) void run(async () => parse(await decodeQr(file))); e.target.value = '' }} /></div>
        </>}
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="modal-actions">{account.totp && <button type="button" className="text-btn danger remove-totp" onClick={() => { setRemoving(true); setSavedSecret(''); setError('') }}>移除认证器</button>}<button type="button" className="btn" onClick={onClose}>取消</button><button type="submit" className="btn primary" disabled={mode !== 'manual'}>{busy ? '保存中…' : '保存认证器'}</button></div>
      </fieldset></form>}
  </Modal>
}
