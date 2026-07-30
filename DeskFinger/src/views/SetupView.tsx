import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { api } from "../api";

/** 首次使用：选择运行目录（项目配置、快速启动、内置文档都存放在这里） */
export default function SetupView({ onReady }: { onReady: () => void }) {
  const [suggested, setSuggested] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.suggestRuntimeDir().then(setSuggested).catch(() => {});
  }, []);

  const apply = async (path: string) => {
    setBusy(true);
    setError("");
    try {
      await api.setRuntimeDir(path);
      onReady();
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  };

  const choose = async () => {
    try {
      const picked = await open({ directory: true, title: "选择 DeskFinger 运行目录" });
      if (typeof picked === "string") await apply(picked);
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <div className="center-screen">
      <div className="setup-card">
        <div className="setup-logo">👆</div>
        <h1>DeskFinger</h1>
        <p className="dim">
          用户级桌面项目启动器：为每个项目集中管理快速启动、一键启动与项目文档。
        </p>
        <div className="setup-tip">
          请先设置一个<b>运行目录</b>。你的项目配置、快速启动条目和项目文档都会保存在该目录下，
          软件不会拷贝你的项目资源，只保存指向它们的链接。
        </div>
        <div className="setup-actions">
          <button className="btn btn-primary btn-lg" onClick={choose} disabled={busy}>
            选择运行目录…
          </button>
          {suggested && (
            <button className="btn btn-lg" onClick={() => apply(suggested)} disabled={busy}>
              使用默认位置
            </button>
          )}
        </div>
        {suggested && <div className="setup-path dim">默认位置：{suggested}</div>}
        {error && <div className="form-error">{error}</div>}
      </div>
    </div>
  );
}
