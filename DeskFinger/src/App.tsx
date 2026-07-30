import { useCallback, useEffect, useState } from "react";
import { api } from "./api";
import type { AppState } from "./types";
import SetupView from "./views/SetupView";
import HomeView from "./views/HomeView";
import ProjectView from "./views/ProjectView";

export default function App() {
  const [state, setState] = useState<AppState | null>(null);
  const [error, setError] = useState("");
  const [projectId, setProjectId] = useState<string | null>(null);

  const reload = useCallback(() => {
    api
      .getState()
      .then((s) => {
        setState(s);
        setError("");
      })
      .catch((e) => setError(String(e)));
  }, []);

  useEffect(reload, [reload]);

  if (error) {
    return (
      <div className="center-screen">
        <div className="error-box">加载失败：{error}</div>
      </div>
    );
  }
  if (!state) {
    return <div className="center-screen dim">正在启动 DeskFinger…</div>;
  }
  if (!state.runtimeDir) {
    return <SetupView onReady={reload} />;
  }
  return projectId ? (
    <ProjectView projectId={projectId} onBack={() => setProjectId(null)} />
  ) : (
    <HomeView runtimeDir={state.runtimeDir} onOpen={setProjectId} onRuntimeChanged={reload} />
  );
}
