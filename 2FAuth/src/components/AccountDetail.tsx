import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { api } from '../api'
import type { Account, AppState, Notify, RecoveryCode, TimeStatus } from '../types'
import { codeTiming, readTimedCode, type TimedCode } from '../clock'
import Icon from './Icon'
import Modal from './Modal'

export default function AccountDetail({ account, onChange, onEdit, notify, timeStatus, onTimeStatus }: { account: Account; onChange: (state: AppState) => void; onEdit: () => void; notify: Notify; timeStatus: TimeStatus | null; onTimeStatus: (status: TimeStatus) => void }) {
  const [frame, setFrame] = useState<TimedCode | null>(null); const [, refreshTick] = useState(0); const [codeError, setCodeError] = useState('')
  const latestTime = useRef(timeStatus); latestTime.current = timeStatus
  const [concealed, setConcealed] = useState(false); const [copied, setCopied] = useState(false); const [busy, setBusy] = useState(false)
  const [tab, setTab] = useState<'recovery' | 'details'>('recovery')
  const [recovery, setRecovery] = useState<RecoveryCode[] | null>(null); const [secret, setSecret] = useState('')
  const [editingRecovery, setEditingRecovery] = useState(false); const [recoveryText, setRecoveryText] = useState('')
  const [deleting, setDeleting] = useState(false); const [formError, setFormError] = useState('')
  const alive = useRef(true); const requestVersion = useRef(0)
  const copiedTimer = useRef<number>()
  useEffect(() => { alive.current = true; return () => { alive.current = false; window.clearTimeout(copiedTimer.current) } }, [])
  useEffect(() => {
    let stopped = false; let pending = false
    setFrame(null)
    const refresh = async () => {
      refreshTick(n => n + 1)
      if (pending || document.hidden) return
      pending = true
      const version = requestVersion.current
      try { const next = await readTimedCode(account.id); if (!stopped && version === requestVersion.current) { onTimeStatus(next.value.timeStatus); setFrame(next); setCodeError('') } }
      catch (e) { if (!stopped) { setFrame(null); setCodeError(String(e)) } }
      finally { pending = false }
    }
    const hide = () => { requestVersion.current++; setSecret(''); setRecovery(null); setFrame(null); setCopied(false) }
    const visibility = () => { if (document.hidden) hide(); else void refresh() }
    void refresh(); const timer = window.setInterval(refresh, 500)
    document.addEventListener('visibilitychange', visibility); window.addEventListener('blur', hide)
    return () => { stopped = true; window.clearInterval(timer); document.removeEventListener('visibilitychange', visibility); window.removeEventListener('blur', hide) }
  }, [account.id, account.algorithm, account.digits, account.period, timeStatus?.revision, onTimeStatus])
  const { valid, remaining } = codeTiming(frame, timeStatus?.revision)
  const displayCode = valid && !concealed ? frame!.value.code.replace(/(.{3,4})(?=.{3,4}$)/, '$1 ') : concealed ? '••• •••' : '––– –––'
  async function act(task: () => Promise<void>) { if (busy) return; setBusy(true); try { await task() } catch (e) { notify(String(e), true) } finally { if (alive.current) setBusy(false) } }
  async function copyCode() {
    await act(async () => {
      // Always calculate again at click time, including around a period boundary.
      const fresh = await readTimedCode(account.id)
      if (!alive.current || document.hidden) return
      if (!codeTiming(fresh, latestTime.current?.revision).valid) throw new Error('验证码已过期或时间来源已变化，请重试')
      await api.copy(fresh.value.code); onTimeStatus(fresh.value.timeStatus); setFrame(fresh); setCopied(true)
      window.clearTimeout(copiedTimer.current); copiedTimer.current = window.setTimeout(() => setCopied(false), 1800)
    })
  }
  async function showRecovery() {
    if (recovery) { requestVersion.current++; setRecovery(null); return }
    await act(async () => { const version = requestVersion.current; const result = await api.recovery(account.id); if (alive.current && version === requestVersion.current) setRecovery(result) })
  }
  return <section className="detail-pane" aria-label="账户详情" style={{ '--account-color': account.color } as CSSProperties}>
    <header className="detail-header"><div className="avatar large">{account.issuer.slice(0, 2)}</div><div className="detail-title"><div className="eyebrow">AUTHENTICATOR</div><h2>{account.issuer}<span className="tag">{account.group || '未分组'}</span></h2><p className="selectable">{account.account}</p></div><button className={`icon-btn ${account.favorite ? 'favorited' : ''}`} title={account.favorite ? '取消收藏' : '收藏账户'} aria-label={account.favorite ? '取消收藏' : '收藏账户'} disabled={busy} onClick={() => act(async () => onChange(await api.favorite(account.id, !account.favorite)))}><Icon name="star" /></button><button className="btn" onClick={onEdit}><Icon name="edit" size={14} />编辑</button></header>
    <div className="detail-scroll">
      <div className={`otp-card ${remaining <= 5 && valid ? 'expiring' : ''}`}>
        <div className="otp-top"><span><i className="status-dot" />动态验证码</span><button className="icon-btn" title={concealed ? '显示验证码' : '隐藏验证码'} aria-label={concealed ? '显示验证码' : '隐藏验证码'} onClick={() => setConcealed(!concealed)}><Icon name={concealed ? 'eye' : 'hide'} size={17} /></button></div>
        <div className="otp-main"><button className={`otp-value ${concealed ? 'concealed' : ''}`} aria-label="点击复制验证码" disabled={busy || !valid} onClick={copyCode}>{displayCode}</button><div className="countdown" aria-label={`剩余 ${remaining} 秒`}><svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="27" className="ring-track" /><circle cx="32" cy="32" r="27" className="ring-progress" strokeDasharray={Math.PI * 54} strokeDashoffset={Math.PI * 54 * (1 - remaining / account.period)} /></svg><span>{valid ? remaining : '—'}<small>秒</small></span></div></div>
        <div className="otp-bottom"><span>{valid ? remaining <= 5 ? '即将更新，请留意有效时间' : `每 ${account.period} 秒自动更新` : '正在读取当前验证码…'}</span><button className={`btn ${copied ? 'copied' : 'primary'}`} disabled={busy || !valid} onClick={copyCode}><Icon name={copied ? 'check' : 'copy'} size={15} />{copied ? '已复制' : '复制验证码'}</button></div>
        {codeError && <p className="form-error" role="alert">{codeError}</p>}
      </div>
      <div className="parameter-strip"><span><Icon name="shield" size={14} />{account.algorithm.replace('SHA', 'HMAC-SHA-')}</span><span>{account.digits} 位验证码</span><span><Icon name="clock" size={14} />{account.period} 秒周期</span><span className="local-label">{timeStatus?.source === "network" ? "网络时间 · 本机生成" : "本地时间 · 本机生成"}</span></div>
      <div className="detail-tabs" role="tablist" aria-label="账户信息"><button role="tab" aria-selected={tab === 'recovery'} className={tab === 'recovery' ? 'active' : ''} onClick={() => { setTab('recovery'); setSecret('') }}><Icon name="key" size={16} />恢复码<span className="count">{account.recoveryRemaining}</span></button><button role="tab" aria-selected={tab === 'details'} className={tab === 'details' ? 'active' : ''} onClick={() => { setTab('details'); setRecovery(null) }}><Icon name="info" size={16} />账户信息</button></div>
      {tab === 'recovery' ? <div className="recovery-section" role="tabpanel" aria-label="恢复码">
        <div className="section-heading"><div><strong>备用恢复码</strong><p>{account.recoveryTotal ? `${account.recoveryRemaining} 个可用 · ${account.recoveryTotal - account.recoveryRemaining} 个已使用` : '在无法使用验证码时，帮助你找回账户'}</p></div><div className="actions">{account.recoveryTotal > 0 && <button className="text-btn" disabled={busy} onClick={showRecovery}><Icon name={recovery ? 'hide' : 'eye'} size={14} />{recovery ? '隐藏' : '显示'}</button>}<button className="btn small" disabled={busy} onClick={() => act(async () => { const result = await api.recovery(account.id); if (alive.current) { setRecoveryText(result.map(c => c.code).join('\n')); setEditingRecovery(true); setFormError('') } })}><Icon name={account.recoveryTotal ? 'edit' : 'plus'} size={14} />{account.recoveryTotal ? '管理' : '添加恢复码'}</button></div></div>
        {!account.recoveryTotal ? <div className="recovery-empty"><div className="empty-symbol"><Icon name="key" size={25} /></div><strong>留一份备用，更安心</strong><p>将平台提供的恢复码保存到这里，<br />使用后可逐条标记。</p></div> : <><div className="recovery-grid">{recovery ? recovery.map((c, index) => <div className={`recovery-row ${c.used ? 'used' : ''}`} key={c.id}><span className="recovery-index">{String(index + 1).padStart(2, '0')}</span><code>{c.code}</code><button className="icon-btn" disabled={busy || c.used} aria-label={`复制恢复码 ${index + 1}`} onClick={() => act(async () => { await api.copy(c.code); notify('恢复码已复制；使用成功后请标记为已使用') })}><Icon name="copy" size={14} /></button><button className={`usage-button ${c.used ? 'used' : ''}`} disabled={busy} aria-label={`${c.used ? '恢复可用' : '标记已使用'} ${index + 1}`} title={c.used ? '恢复为可用' : '标记为已使用'} onClick={() => act(async () => { onChange(await api.used(account.id, c.id, !c.used)); if (alive.current) setRecovery(prev => prev?.map(item => item.id === c.id ? { ...item, used: !c.used } : item) ?? null) })}>{c.used ? <Icon name="check" size={14} /> : <span />}</button></div>) : Array.from({ length: Math.min(account.recoveryTotal, 8) }, (_, i) => <div className="recovery-row masked" key={i}><span className="recovery-index">{String(i + 1).padStart(2, '0')}</span><code>•••• – ••••</code><Icon name="key" size={13} /></div>)}</div><p className="hint recovery-hint">恢复码由平台签发，通常仅能使用一次。复制不会自动标记；请在登录成功后标记。{!recovery && account.recoveryTotal > 8 && ` 共 ${account.recoveryTotal} 条，显示后可查看全部。`}</p></>}
      </div> : <div className="account-info" role="tabpanel" aria-label="账户信息"><div className="section-heading"><strong>共享密钥</strong><button className="text-btn" disabled={busy} onClick={() => { if (secret) { setSecret(''); requestVersion.current++ } else void act(async () => { const version = requestVersion.current; const value = await api.secret(account.id); if (alive.current && version === requestVersion.current) setSecret(value) }) }}><Icon name={secret ? 'hide' : 'eye'} size={15} />{secret ? '隐藏密钥' : '显示密钥'}</button></div><p className="secret-value mono selectable">{secret || '•••• •••• •••• ••••'}</p><p className="hint">共享密钥可生成此账户的验证码，请妥善保存。</p><div className="section-heading notes-heading"><strong>备注</strong></div><p className="notes selectable">{account.notes || '暂无备注'}</p><div className="danger-zone"><span>移除本地账户与恢复码</span><button className="text-btn danger" onClick={() => { setDeleting(true); setFormError('') }}><Icon name="trash" size={14} />删除账户</button></div></div>}
    </div>
    <footer className="detail-footer"><Icon name="info" size={13} /><span>{timeStatus?.source === "network" ? "已使用网络校正时间。若校验失败，请核对平台参数。" : timeStatus?.enabled ? "当前使用本地时间，网络校时尚未生效。请留意顶部校时状态。" : "当前使用本地时间。若校验失败，可在顶部开启联网校时。"}</span></footer>
    {editingRecovery && <Modal title="管理恢复码" onClose={() => setEditingRecovery(false)} busy={busy}><form onSubmit={async e => {
      e.preventDefault(); setBusy(true); setFormError('')
      try { const state = await api.saveRecovery(account.id, recoveryText); onChange(state); setRecovery(null); setEditingRecovery(false); setRecoveryText(''); notify('恢复码已保存') } catch (e) { setFormError(String(e)) } finally { setBusy(false) }
    }}><label className="field"><span>恢复码 · 每行一条</span><textarea data-autofocus className="mono" autoComplete="off" spellCheck={false} rows={10} disabled={busy} value={recoveryText} onChange={e => setRecoveryText(e.target.value)} placeholder="粘贴平台提供的恢复码，每行一条" /></label><p className="hint">空行和重复项会自动移除。保留的恢复码沿用其使用状态，删除某行会移除该条恢复码；留空保存将清空全部恢复码。</p>{formError && <p role="alert" className="form-error">{formError}</p>}<div className="modal-actions"><button type="button" className="btn" disabled={busy} onClick={() => setEditingRecovery(false)}>取消</button><button className="btn primary" disabled={busy}>保存恢复码</button></div></form></Modal>}
    {deleting && <Modal title="删除认证账户" onClose={() => setDeleting(false)} busy={busy}><p className="confirm-message">确定删除 <strong>{account.issuer} · {account.account}</strong>？本地密钥和恢复码将被移除。此操作不会关闭平台上的双因素认证，请确保你还有其他登录方式。</p>{formError && <p role="alert" className="form-error">{formError}</p>}<div className="modal-actions"><button className="btn" disabled={busy} onClick={() => setDeleting(false)}>取消</button><button className="btn danger-solid" disabled={busy} onClick={async () => { setBusy(true); try { onChange(await api.delete(account.id)); notify('账户已删除') } catch (e) { setFormError(String(e)) } finally { if (alive.current) setBusy(false) } }}>确认删除</button></div></Modal>}
  </section>
}
