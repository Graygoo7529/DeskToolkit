import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

export function moveItem(ids: string[], from: string, to: string) {
  const a = ids.indexOf(from), b = ids.indexOf(to);
  if (a < 0 || b < 0 || a === b) return ids;
  const next = [...ids];
  next.splice(a, 1);
  next.splice(b, 0, from);
  return next;
}

export default function SortableList<T extends { id: string }>({
  items, className, disabled, label, onReorder, render,
}: {
  items: T[];
  className: string;
  disabled?: boolean;
  label: (item: T) => string;
  onReorder: (ids: string[]) => void;
  render: (item: T) => ReactNode;
}) {
  const source = useRef<string | null>(null);
  const nodes = useRef(new Map<string, HTMLDivElement>());
  const positions = useRef(new Map<string, { x: number; y: number }>());
  const previousOrder = useRef<string[]>([]);
  const suppressClickUntil = useRef(0);
  const dragAllowed = useRef(true);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);

  useLayoutEffect(() => {
    const order = items.map(item => item.id);
    const previous = previousOrder.current;
    const reordered = order.length === previous.length
      && order.every(id => previous.includes(id))
      && order.some((id, index) => previous[index] !== id);
    const next = new Map<string, { x: number; y: number }>();
    nodes.current.forEach((node, id) => {
      if (!node.getClientRects().length) return;
      const position = { x: node.offsetLeft, y: node.offsetTop };
      const previousPosition = positions.current.get(id);
      if (reordered && previousPosition && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        node.animate([{ transform: `translate(${previousPosition.x - position.x}px, ${previousPosition.y - position.y}px)` }, { transform: "translate(0, 0)" }], { duration: 230, easing: "cubic-bezier(.2,.8,.2,1)" });
      }
      next.set(id, position);
    });
    if (next.size) positions.current = next;
    previousOrder.current = order;
  }, [items]);

  const finish = () => {
    source.current = null;
    setDragging(null);
    setOver(null);
    suppressClickUntil.current = performance.now() + 220;
  };

  return <div className={`${className} sortable-list`}>
    {items.map((item, index) => <div
      key={item.id}
      ref={node => { if (node) nodes.current.set(item.id, node); else nodes.current.delete(item.id); }}
      className={`sortable-item${over === item.id && over !== dragging ? " drop-target" : ""}${dragging === item.id ? " dragging" : ""}`}
      role="group"
      aria-label={`排序 ${label(item)}`}
      aria-grabbed={dragging === item.id}
      aria-roledescription={disabled ? undefined : "可拖动项"}
      title={disabled ? undefined : "拖动排序，或按 Alt + 方向键调整"}
      tabIndex={disabled ? -1 : 0}
      draggable={!disabled}
      onPointerDownCapture={event => {
        const control = (event.target as HTMLElement).closest("button,input,select,summary,a");
        dragAllowed.current = !control || control.hasAttribute("data-drag-surface");
      }}
      onClickCapture={event => {
        if (performance.now() < suppressClickUntil.current) {
          event.stopPropagation();
          event.preventDefault();
        }
      }}
      onDragStart={event => {
        const control = (event.target as HTMLElement).closest("button,input,select,summary,a");
        if (disabled || !dragAllowed.current || (control && !control.hasAttribute("data-drag-surface"))) {
          event.preventDefault();
          return;
        }
        source.current = item.id;
        setDragging(item.id);
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", item.id);
      }}
      onDragEnd={finish}
      onDragEnter={() => { if (!disabled && source.current !== null) setOver(item.id); }}
      onDragOver={event => {
        if (!disabled && source.current !== null) {
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
          setOver(item.id);
        }
      }}
      onDrop={event => {
        event.preventDefault();
        if (!disabled && source.current !== null && source.current !== item.id) {
          onReorder(moveItem(items.map(entry => entry.id), source.current, item.id));
        }
        finish();
      }}
      onKeyDown={event => {
        if (disabled || !event.altKey || !["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) return;
        event.preventDefault();
        event.stopPropagation();
        const other = items[index + (["ArrowUp", "ArrowLeft"].includes(event.key) ? -1 : 1)];
        if (other) onReorder(moveItem(items.map(entry => entry.id), item.id, other.id));
      }}
    >{render(item)}</div>)}
  </div>;
}
