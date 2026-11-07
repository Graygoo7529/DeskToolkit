import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { codeTiming, readTimedCode, type TimedCode } from '../clock'
import type { Notify, TimeStatus, TotpSummary } from '../types'
import Icon from './Icon'

export default function TotpCard({ id, config, timeStatus, onTimeStatus, onConfigure, notify }: { id: string; config: TotpSummary | null; timeStatus: TimeStatus | null; onTimeStatus: (status: TimeStatus) => void; onConfigure: () => void; notify: Notify }) {
  const [frame, setFrame] = useState<TimedCode | null>(null); const [, tick] = useState(0)
  const [error, setError] = useState(''); const [hidden, setHidden] = useState(false); const [busy, setBusy] = useState(false); const [copied, setCopied] = useState(false)
  const [secret, setSecret] = useState<string | null>(null); const [secretBusy, setSecretBusy] = useState(false)
  const alive = useRef(true); const version = useRef(0); const copiedTimer = useRef<number>(); const latestTime = useRef(timeStatus); latestTime.current = timeStatus
  useEffect(() => { alive.current = true; return () => { alive.current = false; version.current++; window.clearTimeout(copiedTimer.current) } }, [])
  useEffect(() => {
    if (!config) return
    let stopped = false; let pending = false
    setFrame(null)
    const refresh = async () => {
      tick(v => v + 1)
      if (pending || document.hidden) return
      pending = true; const request = version.current
      try { const next = await readTimedCode(id); if (!stopped && request === version.current) { onTimeStatus(next.value.timeStatus); setFrame(next); setError('') } }
      catch (e) { if (!stopped) { setFrame(null); setError(String(e)) } }
      finally { pending = false }
    }
    const hide = () => { version.current++; setFrame(null); setCopied(false); setSecret(null) }
    const visibility = () => { if (document.hidden) hide(); else void refresh() }
    void refresh(); const timer = window.setInterval(refresh, 500)
    document.addEventListener('visibilitychange', visibility); window.addEventListener('blur', hide)
    return () => { stopped = true; window.clearInterval(timer); document.removeEventListener('visibilitychange', visibility); window.removeEventListener('blur', hide) }
  }, [id, config?.algorithm, config?.digits, config?.period, timeStatus?.revision, onTimeStatus])
  const { valid, remaining } = codeTiming(frame, timeStatus?.revision)
  async function secretAction(reveal: boolean) {
    if (secretBusy) return
    if (reveal && secret !== null) { version.current++; setSecret(null); return }
    setSecretBusy(true); const request = version.current
    try {
      if (reveal) { const value = await api.totpSecret(id); if (alive.current && request === version.current && !document.hidden) setSecret(value) }
      else { await api.copyTotpSecret(id); if (alive.current) notify('2FA 原码已复制') }
    } catch (e) { if (alive.current) notify(String(e), true) } finally { if (alive.current) setSecretBusy(false) }
  }
  async function copy() {
    if (busy) return; setBusy(true)
    try {
      const fresh = await readTimedCode(id)
      if (!alive.current || document.hidden) return
      if (!codeTiming(fresh, latestTime.current?.revision).valid) throw new Error('验证码已过期或时间来源已变化，请重试')
      await api.copy(fresh.value.code)
      if (alive.current) { onTimeStatus(fresh.value.timeStatus); setFrame(fresh); setCopied(true); window.clearTimeout(copiedTimer.current); copiedTimer.current = window.setTimeout(() => setCopied(false), 1800) }
    } catch (e) { if (alive.current) notify(String(e), true) } finally { if (alive.current) setBusy(false) }
  }
  if (!config) return <section className="totp-empty" aria-label="双因素认证"><div className="empty-symbol"><Icon name="shield" size={20} /></div><div><strong>添加动态验证码</strong><p>为此账户关联 TOTP 认证器，登录时一处取用。</p></div><button className="btn small" onClick={onConfigure}><Icon name="plus" size={14} />配置认证器</button></section>
  return <section className={`otp-card ${valid && remaining <= 5 ? 'expiring' : ''}`} aria-label="双因素认证">
    <div className="otp-top"><span><Icon name="shield" size={15} />账户 2FA 认证 <small>TOTP</small></span><button className="text-btn" onClick={onConfigure}><Icon name="edit" size={13} />管理认证器</button></div>
    <div className="totp-secret-row"><span className="credential-label">2FA 原码</span><span className={`mono selectable ${secret === null ? 'masked' : ''}`} data-testid="totp-secret">{secret ?? '••••••••••••••••'}</span><button className="icon-btn" disabled={secretBusy} aria-label={secret === null ? '显示 2FA 原码' : '隐藏 2FA 原码'} onClick={() => secretAction(true)}><Icon name={secret === null ? 'eye' : 'hide'} size={15} /></button><button className="icon-btn" disabled={secretBusy} aria-label="复制 2FA 原码" onClick={() => secretAction(false)}><Icon name="copy" size={15} /></button></div>
    <div className="totp-code-label">动态验证码</div>
    <div className="otp-main"><button className={`otp-value ${hidden ? 'concealed' : ''}`} aria-label="点击复制验证码" disabled={busy || !valid} onClick={copy}>{hidden ? '•'.repeat(config.digits).replace(/(.{3,4})(?=.{3,4}$)/, '$1 ') : valid ? frame!.value.code.replace(/(.{3,4})(?=.{3,4}$)/, '$1 ') : '––– –––'}</button><button className="icon-btn" aria-label={hidden ? '显示验证码' : '隐藏验证码'} onClick={() => setHidden(!hidden)}><Icon name={hidden ? 'eye' : 'hide'} size={16} /></button><div className="countdown" aria-label={`剩余 ${remaining} 秒`}><svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="27" className="ring-track" /><circle cx="32" cy="32" r="27" className="ring-progress" strokeDasharray={Math.PI * 54} strokeDashoffset={Math.PI * 54 * (1 - remaining / config.period)} /></svg><span>{valid ? remaining : '–'}<small>秒</small></span></div></div>
    <div className="otp-bottom"><span>{config.algorithm.replace('SHA', 'HMAC-SHA-')} · {config.digits} 位 · {config.period} 秒<br /><small>{timeStatus?.source === 'network' ? '网络校正时间 · 本机生成' : '本地时间 · 本机生成'}</small></span><button className={`btn ${copied ? 'copied' : 'primary'}`} disabled={busy || !valid} onClick={copy}><Icon name={copied ? 'check' : 'copy'} size={14} />{copied ? '验证码已复制' : '复制验证码'}</button></div>
    {error && <p className="form-error" role="alert">{error}</p>}
  </section>
}
