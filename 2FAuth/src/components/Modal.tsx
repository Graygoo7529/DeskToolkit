import { useEffect, useId, useRef, type ReactNode } from 'react'
import Icon from './Icon'

export default function Modal({ title, onClose, busy = false, children, wide = false }: { title: string; onClose: () => void; busy?: boolean; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  const close = useRef(onClose); close.current = onClose
  const pending = useRef(busy); pending.current = busy
  const titleId = useId()
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const root = ref.current!
    const focusables = () => Array.from(root.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]')).filter(e => e.getClientRects().length)
    ;(root.querySelector<HTMLElement>('[data-autofocus]') ?? focusables()[0] ?? root).focus()
    const listener = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !pending.current) { event.preventDefault(); close.current() }
      if (event.key === 'Tab') {
        const list = focusables(); const first = list[0]; const last = list[list.length - 1]
        if (!first) { event.preventDefault(); root.focus(); return }
        if (event.shiftKey && (document.activeElement === first || !root.contains(document.activeElement))) { event.preventDefault(); last.focus() }
        if (!event.shiftKey && (document.activeElement === last || !root.contains(document.activeElement))) { event.preventDefault(); first.focus() }
      }
    }
    document.addEventListener('keydown', listener)
    return () => { document.removeEventListener('keydown', listener); previous?.focus() }
  }, [])
  return <div className="overlay" onMouseDown={e => { if (e.target === e.currentTarget && !busy) onClose() }}>
    <div ref={ref} tabIndex={-1} className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <div className="modal-head"><h2 id={titleId}>{title}</h2><button className="icon-btn" aria-label="关闭弹窗" disabled={busy} onClick={onClose}><Icon name="close" /></button></div>
      {children}
    </div>
  </div>
}
