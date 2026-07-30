import { useState } from "react";
import { PROJECT_COLORS, PROJECT_ICONS, type Project } from "../types";
import Modal from "./Modal";

interface ProjectMetaModalProps {
  title: string;
  initial?: Pick<Project, "name" | "description" | "icon" | "color">;
  onSave: (meta: { name: string; description: string; icon: string; color: string }) => Promise<void> | void;
  onClose: () => void;
}

/** 新建 / 编辑项目基本信息 */
export default function ProjectMetaModal({ title, initial, onSave, onClose }: ProjectMetaModalProps) {
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [icon, setIcon] = useState(initial?.icon ?? PROJECT_ICONS[0]);
  const [color, setColor] = useState(initial?.color ?? PROJECT_COLORS[0]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!name.trim()) return setError("请填写项目名称");
    setBusy(true);
    try {
      await onSave({ name: name.trim(), description: description.trim(), icon, color });
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  };

  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            取消
          </button>
          <button className="btn btn-primary" onClick={save} disabled={busy}>
            保存
          </button>
        </>
      }
    >
      <label className="field">
        <span>项目名称</span>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：DeskFinger" autoFocus />
      </label>

      <label className="field">
        <span>项目描述（可选）</span>
        <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="一句话说明这个项目" />
      </label>

      <div className="field">
        <span>图标</span>
        <div className="icon-picker">
          {PROJECT_ICONS.map((i) => (
            <button key={i} type="button" className={`icon-option ${icon === i ? "active" : ""}`} onClick={() => setIcon(i)}>
              {i}
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <span>主题色</span>
        <div className="color-picker">
          {PROJECT_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              className={`color-option ${color === c ? "active" : ""}`}
              style={{ background: c }}
              onClick={() => setColor(c)}
            />
          ))}
        </div>
      </div>

      {error && <div className="form-error">{error}</div>}
    </Modal>
  );
}
