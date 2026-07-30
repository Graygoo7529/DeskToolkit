import type { ReactNode } from "react";

interface ModalProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  /** 附加到 .modal 的额外类名，例如 "wide" 宽弹窗 */
  className?: string;
}

export default function Modal({ title, onClose, children, footer, className }: ModalProps) {
  return (
    <div
      className="modal-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={`modal${className ? ` ${className}` : ""}`}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="btn btn-icon" onClick={onClose} title="关闭">
            ✕
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}
