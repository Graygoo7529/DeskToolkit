import { useEffect, useRef, useState } from "react";
import Icon from "./Icons";

type Props = {
  name: string;
  canDelete: boolean;
  onRename: () => void;
  onDelete: () => void;
};

export default function FolderMenu({ name, canDelete, onRename, onDelete }: Props) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const first = panel.current?.querySelector<HTMLButtonElement>("button:not(:disabled)");
    first?.focus();
    const dismiss = (event: PointerEvent) => {
      if (!panel.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) setOpen(false);
    };
    const blur = (event: FocusEvent) => {
      if (!panel.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) setOpen(false);
    };
    const key = (event: KeyboardEvent) => {
      if (!panel.current?.contains(document.activeElement) && document.activeElement !== trigger.current) return;
      if (event.key === "Escape") { event.preventDefault(); setOpen(false); trigger.current?.focus(); return; }
      if (event.key === "Tab") { event.preventDefault(); setOpen(false); trigger.current?.focus(); return; }
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
      const items = Array.from(panel.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") || []);
      if (!items.length) return;
      event.preventDefault();
      const index = items.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (index + (event.key === "ArrowUp" ? -1 : 1) + items.length) % items.length;
      items[next]?.focus();
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("focusin", blur);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("focusin", blur);
      document.removeEventListener("keydown", key);
    };
  }, [open]);

  const action = (run: () => void) => {
    setOpen(false);
    trigger.current?.focus();
    run();
  };
  return <div className="folder-menu">
    <button ref={trigger} className="icon-button folder-menu-trigger" aria-label="便签夹选项" title="便签夹选项" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(value => !value)}><Icon name="more" size={17} /></button>
    {open && <div ref={panel} className="folder-menu-panel" role="menu" aria-label={`${name}的便签夹操作`}>
      <div className="folder-menu-caption" title={name}>{name}</div>
      <button role="menuitem" onClick={() => action(onRename)}><Icon name="edit" size={14} />重命名 note 夹</button>
      <button role="menuitem" className="folder-menu-danger" disabled={!canDelete} title={canDelete ? "永久删除此 note 夹" : "至少保留一个 note 夹"} onClick={() => action(onDelete)}><Icon name="trash" size={14} />删除 note 夹</button>
    </div>}
  </div>;
}
