import { test, expect, type Page } from "@playwright/test";

// Exercise the desktop UI against a delayed IPC transport. Rust tests cover actual disk IO.
async function mockDesktop(page: Page, broken = false) {
  await page.addInitScript(({ broken }) => {
    const state = {
      current: broken ? "B:\\missing" : null as string | null,
      failSave: false,
      log: [] as string[],
      drafts: [] as any[],
      directories: {} as Record<string, any>,
    };
    state.directories["B:\\existing"] = { clusters: [{ id: "inbox", name: "已有目录", icon: "folder", color: "#8fa9f7", notes: [{ id: "note", title: "同 ID 的另一个版本", content: "# 来自另一个目录", color: "#8fa9f7", updatedAt: 1 }] }] };
    const w = window as any;
    w.__disk = state;
    w.isTauri = true;
    w.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
    w.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main", windowLabel: "main" } },
      transformCallback: () => 1,
      unregisterCallback() {},
      async invoke(command: string, args: any) {
        if (command.startsWith("plugin:event|")) return 1;
        if (command === "get_state") return { dataDir: state.current, suggestedDir: "B:\\first" };
        if (command === "load_workspace") {
          if (!state.current || !state.directories[state.current]) throw "目录暂时不可用";
          return { dataDir: state.current, workspace: structuredClone(state.directories[state.current]) };
        }
        if (command === "set_data_dir") {
          if (!state.directories[args.path]) state.directories[args.path] = structuredClone(args.seed);
          state.current = args.path;
          state.log.push("switch:" + args.path);
          return { dataDir: args.path, workspace: structuredClone(state.directories[args.path]) };
        }
        if (command === "save_workspace") {
          await new Promise(resolve => setTimeout(resolve, 200));
          if (state.failSave) throw "模拟磁盘只读";
          if (state.current !== args.path) throw "旧目录延迟写入";
          state.directories[args.path] = structuredClone(args.workspace);
          state.log.push("save:" + args.path);
          return;
        }
        if (command === "preserve_and_reload") {
          state.drafts.push(structuredClone(args.workspace));
          state.failSave = false;
          return { dataDir: state.current, workspace: structuredClone(state.directories[state.current!]) };
        }
        if (command === "open_note_file") { state.log.push("open:" + args.noteId); return; }
        throw new Error("Unexpected IPC: " + command);
      },
    };
    // Deliberately retain identical IDs in both workspaces to detect stale editor content.
    localStorage.setItem("desktodo-workspace-v1", JSON.stringify({ clusters: [{ id: "inbox", name: "旧收件箱", icon: "folder", color: "#8fa9f7", notes: [{ id: "note", title: "原便签", content: "# 原目录内容", color: "#8fa9f7", updatedAt: 1 }] }] }));
  }, { broken });
}

async function switchDirectory(page: Page, path: string) {
  await page.getByRole("button", { name: /数据目录 保存在此设备/ }).click();
  await page.getByRole("textbox", { name: "数据目录路径" }).fill(path);
  await page.getByRole("button", { name: "使用此目录", exact: true }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
}

test("desktop migration waits for saves, reopens identical IDs and exposes recoverable save errors", async ({ page }) => {
  await mockDesktop(page);
  await page.goto("/");
  await page.getByRole("button", { name: "迁入便签并开始", exact: true }).click();
  await page.getByRole("textbox", { name: "便签标题", exact: true }).fill("迁移前的最新修改");
  await switchDirectory(page, "B:\\existing");
  await expect(page.locator(".note-document h1")).toHaveText("来自另一个目录");
  await switchDirectory(page, "B:\\first");
  await expect(page.locator(".note-document h1")).toHaveText("原目录内容");
  await expect(page.getByRole("textbox", { name: "便签标题", exact: true })).toHaveValue("迁移前的最新修改");
  const log = await page.evaluate(() => (window as any).__disk.log as string[]);
  expect(log.indexOf("save:B:\\first")).toBeLessThan(log.indexOf("switch:B:\\existing"));
  await page.evaluate(() => { (window as any).__disk.failSave = true; });
  await page.getByRole("textbox", { name: "便签标题", exact: true }).fill("失败后仍保留的修改");
  await expect(page.locator(".save-status")).toHaveText("5 秒后自动保存");
  await expect(page.getByRole("alert")).toContainText("模拟磁盘只读", { timeout: 8000 });
  await expect(page.locator(".save-status")).toHaveText("未能保存", { timeout: 8000 });
  await page.evaluate(() => { (window as any).__disk.failSave = false; });
  await page.getByRole("button", { name: "重试保存", exact: true }).click();
  await expect(page.locator(".save-status")).toHaveText("已保存", { timeout: 8000 });
  await switchDirectory(page, "B:\\new-copy");
  await expect(page.getByRole("textbox", { name: "便签标题", exact: true })).toHaveValue("失败后仍保留的修改");
  expect(await page.evaluate(() => (window as any).__disk.directories["B:\\first"].clusters[0].notes[0].title)).toBe("失败后仍保留的修改");
});

test("unavailable desktop directory offers recovery without automatically replacing files", async ({ page }) => {
  await mockDesktop(page, true);
  await page.goto("/");
  await expect(page.getByRole("alert")).toContainText("目录暂时不可用");
  expect(await page.evaluate(() => (window as any).__disk.log)).toEqual([]);
  await page.getByRole("button", { name: "选择其他数据目录", exact: true }).click();
  await page.getByRole("textbox", { name: "数据目录路径" }).fill("B:\\existing");
  await page.getByRole("button", { name: "开始使用", exact: true }).click();
  await expect(page.locator(".note-document h1")).toHaveText("来自另一个目录");
});

test("external Markdown edits reload; conflict recovery preserves the draft and allows saving again", async ({ page }) => {
  await mockDesktop(page);
  await page.goto("/");
  await page.getByRole("button", { name: "迁入便签并开始", exact: true }).click();
  await page.getByRole("button", { name: "打开 Markdown 文件", exact: true }).click();
  expect(await page.evaluate(() => (window as any).__disk.log)).toContain("open:note");
  await page.evaluate(() => { (window as any).__disk.directories["B:\\first"].clusters[0].notes[0].content = "# 文件中的修改"; });
  await page.getByRole("button", { name: /数据目录 保存在此设备/ }).click();
  await page.getByRole("button", { name: "重新载入文件", exact: true }).click();
  await expect(page.locator(".note-document h1")).toHaveText("文件中的修改");
  await page.evaluate(() => {
    (window as any).__disk.directories["B:\\first"].clusters[0].notes[0].content = "# 外部新版本";
    (window as any).__disk.failSave = true;
  });
  await page.getByRole("textbox", { name: "便签标题", exact: true }).fill("应用内草稿");
  await expect(page.locator(".save-status")).toHaveText("5 秒后自动保存");
  await expect(page.locator(".save-status")).toHaveText("未能保存", { timeout: 8000 });
  await page.getByRole("button", { name: "保留副本并重新载入", exact: true }).click();
  await expect(page.locator(".note-document h1")).toHaveText("外部新版本");
  expect(await page.evaluate(() => (window as any).__disk.drafts[0].clusters[0].notes[0].title)).toBe("应用内草稿");
  await page.getByRole("textbox", { name: "便签标题", exact: true }).fill("重新保存成功");
  await expect(page.locator(".save-status")).toHaveText("5 秒后自动保存");
  await expect(page.locator(".save-status")).toHaveText("已保存", { timeout: 8000 });
  await switchDirectory(page, "B:\\existing");
  await expect(page.locator(".note-document h1")).toHaveText("来自另一个目录");
});
