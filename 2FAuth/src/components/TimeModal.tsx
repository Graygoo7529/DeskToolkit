import { useState } from 'react'
import { api } from '../api'
import { timeLabel } from '../clock'
import type { TimeStatus } from '../types'
import Modal from './Modal'
import Icon from './Icon'

const timestamp = (value: number | null) => value === null ? '暂无' : new Date(value).toLocaleString('zh-CN', { hour12: false })

export default function TimeModal({ status, onChange, onClose }: { status: TimeStatus | null; onChange: (status: TimeStatus) => void; onClose: () => void }) {
  const [busy, setBusy] = useState(false); const [error, setError] = useState('')
  async function run(task: () => Promise<TimeStatus>) {
    if (busy) return
    setBusy(true); setError('')
    try { onChange(await task()) } catch (e) { setError(String(e)) } finally { setBusy(false) }
  }
  return <Modal title="时间校准" onClose={onClose} busy={busy}>
    <div className="time-toggle-row"><div><strong>联网校时</strong><p>默认关闭 · 仅校正 2FAuth 的计算时间</p></div><button role="switch" aria-label="联网校时" aria-checked={status?.enabled ?? false} className={`toggle ${status?.enabled ? 'on' : ''}`} disabled={busy || !status} onClick={() => run(() => api.onlineTime(!status?.enabled))}><span /></button></div>
    <p className="hint">开启后立即校时，每 15 分钟自动刷新。关闭后取消校时请求、清除校正量，立即使用本地时间。开关设置会在下次启动时保留。</p>
    <div className={`time-status-card ${status?.error ? 'warning' : ''}`}>
      <div className="section-heading"><strong><Icon name="clock" size={16} />{timeLabel(status)}</strong><button className="btn small" disabled={busy || !status?.enabled || status.syncing} onClick={() => run(api.syncTime)}>{status?.syncing ? '校时中…' : '立即校时'}</button></div>
      <dl className="time-facts"><dt>当前时间来源</dt><dd>{status?.source === 'network' ? '网络校正时间' : '本地系统时间'}</dd><dt>应用时间校正量</dt><dd className="mono">{status?.source === 'network' ? `${status.offsetMs >= 0 ? '+' : ''}${(status.offsetMs / 1000).toFixed(3)} 秒` : '0 秒'}</dd><dt>上次成功校时</dt><dd>{timestamp(status?.lastSuccessAt ?? null)}</dd><dt>校正有效至</dt><dd>{timestamp(status?.validUntil ?? null)}</dd>{status?.providers.length ? <><dt>采用的时间来源</dt><dd>{status.providers.join(' + ')}</dd><dt>估计时间误差</dt><dd>约 ±{((status.uncertaintyMs ?? 0) / 1000).toFixed(2)} 秒</dd></> : null}</dl>
      {status?.error && <p className="time-warning" role="status">{status.error}<br />{status.source === 'network' ? '仍在使用有效期内的上次校正结果。' : '当前使用本地系统时间。'}{status.enabled && ' 将在一分钟后自动重试，也可立即重试。'}</p>}
    </div>
    <p className="hint">校时失败时，最多沿用一小时内的有效结果；过期或检测到系统时间变化后回退本地时间。重启后会重新校时。</p>
    <div className="notice time-notice"><Icon name="info" size={17} /><span>仅向 Cloudflare、Microsoft、Google 请求 HTTPS 时间，至少两个来源一致才采用。不发送账户、密钥、恢复码或验证码，不修改 Windows 时间。</span></div>
    <p className="hint">HTTPS 时间为秒级精度，适合常见的 30 秒周期。若系统日期严重错误导致证书校验失败，请先校正电脑日期。</p>
    {error && <p className="form-error" role="alert">{error}</p>}
    {!status && <button className="btn" disabled={busy} onClick={() => run(api.timeStatus)}>重新读取时间状态</button>}
    <div className="modal-actions"><button className="btn" disabled={busy} onClick={onClose}>关闭</button></div>
  </Modal>
}
