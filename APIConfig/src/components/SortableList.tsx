import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'

export function moveItem(names: string[], from: string, to: string) {
  const a = names.indexOf(from), b = names.indexOf(to)
  if (a < 0 || b < 0 || a === b) return names
  const next = [...names]
  next.splice(a, 1); next.splice(b, 0, from)
  return next
}

export default function SortableList<T extends { name: string }>({ items, className, disabled, onReorder, render }: {
  items: T[]; className: string; disabled: boolean
  onReorder: (names: string[]) => void; render: (item: T) => ReactNode
}) {
  const source = useRef<string | null>(null)
  const nodes = useRef(new Map<string, HTMLDivElement>())
  const positions = useRef(new Map<string, number>())
  const previousOrder = useRef<string[]>([])
  const suppressClickUntil = useRef(0)
  const dragAllowed = useRef(true)
  const [dragging, setDragging] = useState<string | null>(null)
  const [over, setOver] = useState<string | null>(null)
  useLayoutEffect(() => {
    const order = items.map((item) => item.name)
    const previous = previousOrder.current
    const reordered = order.length === previous.length && order.every((name) => previous.includes(name)) && order.some((name, i) => previous[i] !== name)
    const next = new Map<string, number>()
    nodes.current.forEach((node, name) => {
      if (!node.getClientRects().length) return
      const top = node.offsetTop
      const oldTop = positions.current.get(name)
      if (reordered && oldTop !== undefined && top !== oldTop && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        node.animate([{ transform: `translateY(${oldTop - top}px)` }, { transform: 'translateY(0)' }], { duration: 230, easing: 'cubic-bezier(.2,.8,.2,1)' })
      }
      next.set(name, top)
    })
    if (next.size) positions.current = next
    previousOrder.current = order
  }, [items])
  const finish = () => { source.current = null; setDragging(null); setOver(null); suppressClickUntil.current = performance.now() + 220 }
  return <div className={className}>
    {items.map((item, index) => <div key={item.name} ref={(node) => { if (node) nodes.current.set(item.name, node); else nodes.current.delete(item.name) }}
      className={`sortable-item${over === item.name && over !== dragging ? ' drop-target' : ''}${dragging === item.name ? ' dragging' : ''}`}
      role="group" aria-label={`排序 ${item.name}`} aria-grabbed={dragging === item.name} aria-roledescription="可拖动项" tabIndex={0} draggable={!disabled}
      onPointerDownCapture={(e) => {
        const control = (e.target as HTMLElement).closest('button,input,select,summary,a')
        dragAllowed.current = !control || control.hasAttribute('data-drag-surface')
      }}
      onClickCapture={(e) => { if (performance.now() < suppressClickUntil.current) { e.stopPropagation(); e.preventDefault() } }}
      onDragStart={(e) => {
        const control = (e.target as HTMLElement).closest('button,input,select,summary,a')
        if (disabled || !dragAllowed.current || (control && !control.hasAttribute('data-drag-surface'))) { e.preventDefault(); return }
        source.current = item.name; setDragging(item.name)
        e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', item.name)
      }}
      onDragEnd={finish}
      onDragEnter={() => { if (!disabled && source.current !== null) setOver(item.name) }}
      onDragOver={(e) => { if (!disabled && source.current !== null) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setOver(item.name) } }}
      onDrop={(e) => {
        e.preventDefault()
        if (!disabled && source.current !== null && source.current !== item.name) onReorder(moveItem(items.map((i) => i.name), source.current, item.name))
        finish()
      }}
      onKeyDown={(e) => {
        if (disabled || !e.altKey || !['ArrowUp', 'ArrowDown'].includes(e.key)) return
        e.preventDefault(); e.stopPropagation()
        const other = items[index + (e.key === 'ArrowUp' ? -1 : 1)]
        if (other) onReorder(moveItem(items.map((i) => i.name), item.name, other.name))
      }}>
      {render(item)}
    </div>)}
  </div>
}
