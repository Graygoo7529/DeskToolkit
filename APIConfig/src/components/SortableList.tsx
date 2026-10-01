import { useRef, useState, type ReactNode, type ButtonHTMLAttributes } from 'react'

export function moveItem(names: string[], from: string, to: string) {
  const a = names.indexOf(from)
  const b = names.indexOf(to)
  if (a < 0 || b < 0 || a === b) return names
  const next = [...names]
  next.splice(a, 1)
  next.splice(b, 0, from)
  return next
}

export default function SortableList<T extends { name: string }>({ items, className, disabled, onReorder, render }: {
  items: T[]
  className: string
  disabled: boolean
  onReorder: (names: string[]) => void
  render: (item: T, handle: ReactNode) => ReactNode
}) {
  const source = useRef<string | null>(null)
  const [over, setOver] = useState<string | null>(null)
  return <div className={className}>
    {items.map((item, index) => {
      const props: ButtonHTMLAttributes<HTMLButtonElement> = {
        type: 'button', className: 'drag-handle', disabled,
        draggable: !disabled, 'aria-label': `拖动排序 ${item.name}`,
        title: '拖动排序；也可聚焦后按 ↑ / ↓ 移动',
        onClick: (e) => e.stopPropagation(),
        onDragStart: (e) => {
          source.current = item.name
          e.dataTransfer.effectAllowed = 'move'
          e.dataTransfer.setData('text/plain', item.name)
        },
        onDragEnd: () => { source.current = null; setOver(null) },
        onKeyDown: (e) => {
          if (!['ArrowUp', 'ArrowDown'].includes(e.key)) return
          e.preventDefault(); e.stopPropagation()
          const other = items[index + (e.key === 'ArrowUp' ? -1 : 1)]
          if (other) onReorder(moveItem(items.map((i) => i.name), item.name, other.name))
        },
      }
      return <div key={item.name} className={`sortable-item${over === item.name ? ' drop-target' : ''}`}
        onDragOver={(e) => { if (!disabled && source.current !== null) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setOver(item.name) } }}
        onDrop={(e) => {
          e.preventDefault()
          if (!disabled && source.current !== null && source.current !== item.name) onReorder(moveItem(items.map((i) => i.name), source.current, item.name))
          source.current = null; setOver(null)
        }}>
        {render(item, <button {...props}>⠿</button>)}
      </div>
    })}
  </div>
}
