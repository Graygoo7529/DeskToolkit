import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { uid } from "../api";
import { KIND_LABEL, type ItemKind, type LaunchItem, type ShellKind } from "../types";
import Modal from "./Modal";

interface ItemModalProps {
  title: string;
  initial?: LaunchItem;
  /** 一键启动场景下显示「启用」开关 */
  showEnabled?: boolean;
  onSave: (item: LaunchItem) => void;
  onClose: () => void;
}

const KINDS: ItemKind[] = ["folder", "app", "file", "command", "web"];

/** 新增 / 编辑一个启动条目（快速启动与一键启动共用） */
export default function ItemModal({ title, initial, showEnabled, onSave, onClose }: ItemModalProps) {
  const [kind, setKind] = useState<ItemKind>(initial?.kind ?? "folder");
  const [name, setName] = useState(initial?.name ?? "");
  const [path, setPath] = useState(initial?.path ?? "");
  const [args, setArgs] = useState(initial?.args ?? "");
  const [shell, setShell] = useState<ShellKind>(initial?.shell ?? "cmd");
  const [keepOpen, setKeepOpen] = useState(initial?.keepOpen ?? true);
  const [enabled, setEnabled] = useState(initial?.enabled ?? true);
  const [error, setError] = useState("");

  const browse = async () => {
    try {
      let picked: string | string[] | null = null;
      if (kind === "folder") {
        picked = await open({ directory: true, title: "选择文件夹" });
      } else if (kind === "app") {
        picked = await open({
          title: "选择应用程序",
          filters: [{ name: "应用程序", extensions: ["exe", "bat", "cmd", "com", "msi", "lnk"] }],
        });
      } else {
        picked = await open({ title: "选择文件" });
      }
      if (typeof picked === "string") setPath(picked);
    } catch (e) {
      setError(String(e));
    }
  };

  const save = () => {
    let finalName = name.trim();
    let finalPath = path.trim();
    if (kind === "web") {
      if (!finalPath) return setError("请填写网页地址");
      // 未写协议时自动补全 https://
      if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(finalPath)) finalPath = `https://${finalPath}`;
      try {
        // 名称为空时使用网站域名作为显示名
        if (!finalName) finalName = new URL(finalPath).hostname.replace(/^www\./, "");
      } catch {
        return setError("网页地址格式不正确，例如 https://example.com");
      }
    }
    if (!finalName) return setError("请填写名称");
    if (!finalPath) return setError(kind === "command" ? "请填写命令内容" : "请选择目标路径");
    onSave({
      id: initial?.id ?? uid(),
      kind,
      name: finalName,
      path: finalPath,
      args: kind === "app" ? args.trim() : "",
      shell: kind === "command" ? shell : "cmd",
      keepOpen: kind === "command" ? keepOpen : true,
      enabled: showEnabled ? enabled : true,
    });
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
          <button className="btn btn-primary" onClick={save}>
            保存
          </button>
        </>
      }
    >
      <label className="field">
        <span>类型</span>
        <div className="kind-picker">
          {KINDS.map((k) => (
            <button
              key={k}
              className={`kind-option ${kind === k ? "active" : ""}`}
              onClick={() => setKind(k)}
              type="button"
            >
              {KIND_LABEL[k]}
            </button>
          ))}
        </div>
      </label>

      <label className="field">
        <span>名称</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={kind === "web" ? "显示名称，留空则使用网站域名" : "显示名称，例如：前端仓库"}
          autoFocus
        />
      </label>

      {kind === "command" ? (
        <>
          <div className="field">
            <span>终端类型</span>
            <div className="kind-picker two">
              <button
                type="button"
                className={`kind-option ${shell === "cmd" ? "active" : ""}`}
                onClick={() => setShell("cmd")}
              >
                CMD
              </button>
              <button
                type="button"
                className={`kind-option ${shell === "powershell" ? "active" : ""}`}
                onClick={() => setShell("powershell")}
              >
                PowerShell
              </button>
            </div>
          </div>
          <label className="field">
            <span>命令内容（每行一条，按顺序执行）</span>
            <textarea
              value={path}
              onChange={(e) => setPath(e.target.value)}
              placeholder={
                shell === "powershell"
                  ? "例如：\ncd D:\\project\nnpm run dev"
                  : "例如：\ncd /d D:\\project\nnpm run dev"
              }
              rows={4}
            />
          </label>
          <span className="field-hint dim">
            批处理类命令（conda activate、npm 等）会自动以 call 方式调用，保证逐条按序执行、窗口不中断
          </span>
          <label className="field field-inline">
            <input type="checkbox" checked={keepOpen} onChange={(e) => setKeepOpen(e.target.checked)} />
            <span>执行完保持终端窗口打开</span>
          </label>
        </>
      ) : kind === "web" ? (
        <>
          <label className="field">
            <span>网页地址</span>
            <input
              value={path}
              onChange={(e) => setPath(e.target.value)}
              placeholder="https://example.com"
              inputMode="url"
            />
          </label>
          <span className="field-hint dim">未填写协议时自动补全 https://，点击条目将用系统默认浏览器打开</span>
        </>
      ) : (
        <label className="field">
          <span>目标路径</span>
          <div className="path-row">
            <input value={path} onChange={(e) => setPath(e.target.value)} placeholder="文件 / 文件夹 / 程序的绝对路径" />
            <button className="btn" onClick={browse} type="button">
              浏览…
            </button>
          </div>
        </label>
      )}

      {kind === "app" && (
        <label className="field">
          <span>启动参数（可选）</span>
          <input value={args} onChange={(e) => setArgs(e.target.value)} placeholder="例如：--inspect --port=3000" />
        </label>
      )}

      {showEnabled && (
        <label className="field field-inline">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          <span>一键启动时执行此项</span>
        </label>
      )}

      {error && <div className="form-error">{error}</div>}
    </Modal>
  );
}
