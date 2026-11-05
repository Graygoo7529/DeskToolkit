import { useEffect, useState } from "react";
import { browseDirectory, desktop, openDirectory } from "./storage";
import { errorText } from "./model";

export default function DirectoryForm({ current, suggested, migrating, onApply, onCancel, onReload, canReload }: {
  current?: string; suggested: string; migrating: boolean; onApply: (path: string) => Promise<void>; onCancel?: () => void;
  onReload?: () => Promise<void>; canReload?: boolean;
}) {
  const [path, setPath] = useState(current ? "" : suggested);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { if (!current) setPath(suggested); }, [suggested, current]);
  const browse = async () => {
    try { const picked = await browseDirectory(); if (picked) setPath(picked); } catch (e) { setError(errorText(e)); }
  };
  const submit = async () => {
    setBusy(true); setError("");
    try { await onApply(path.trim()); } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };
  return <form onSubmit={event => { event.preventDefault(); void submit(); }}>
    {current && <div className="current-directory"><span>当前目录</span><code>{current}</code>{desktop && <button type="button" className="text-button" onClick={() => void openDirectory().catch(e => setError(errorText(e)))}>在文件管理器中打开 ↗</button>}</div>}
    {desktop && <div className="storage-format"><span>便签夹 / 便签.md</span><p>每张便签都是独立的 Markdown 文件，可用其他编辑器打开。</p>{current && onReload && <button type="button" className="text-button" disabled={busy || !canReload} onClick={() => void onReload()}>重新载入文件</button>}</div>}
    {desktop ? <label className="field"><span>{current ? "切换到" : "数据目录"}</span><div className="input-with-button"><input aria-label="数据目录路径" value={path} onChange={e => setPath(e.target.value)} placeholder="选择文件夹或输入绝对路径" disabled={busy} /><button type="button" className="button" onClick={() => void browse()} disabled={busy}>选择目录</button></div></label>
      : <p className="hint">浏览器预览将数据保存在此浏览器。桌面应用支持选择本地数据目录。</p>}
    <p className="hint">{migrating ? "空目录会接收现有便签；原记录会保留。已有 DeskTodo 数据的目录会直接载入。" : "空目录会创建一个收件箱和一张示例便签。选择已有 DeskTodo 目录即可继续使用。"}{desktop && " 旧版数据会自动转为 Markdown 文件，保留原始数据。"}</p>
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="modal-actions">{onCancel && <button type="button" className="button" onClick={onCancel} disabled={busy}>取消</button>}<button className="button primary" disabled={busy || (desktop && !path.trim())}>{busy ? "正在载入…" : current ? "使用此目录" : migrating ? "迁入便签并开始" : "开始使用"}</button></div>
  </form>;
}
