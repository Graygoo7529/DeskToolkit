import { useEffect, useRef, useState } from "react";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";

/**
 * 监听 Tauri 窗口的文件拖放事件。
 * 返回 dragging 用于渲染拖放提示层；onDrop 收到绝对路径列表。
 */
export function useFileDrop(onDrop: (paths: string[]) => void) {
  const [dragging, setDragging] = useState(false);
  const cbRef = useRef(onDrop);
  cbRef.current = onDrop;

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let mounted = true;
    getCurrentWebviewWindow()
      .onDragDropEvent((event) => {
        const p = event.payload;
        if (p.type === "enter") setDragging(true);
        else if (p.type === "leave") setDragging(false);
        else if (p.type === "drop") {
          setDragging(false);
          if (p.paths.length > 0) cbRef.current(p.paths);
        }
      })
      .then((f) => {
        if (mounted) unlisten = f;
        else f();
      });
    return () => {
      mounted = false;
      unlisten?.();
    };
  }, []);

  return dragging;
}
