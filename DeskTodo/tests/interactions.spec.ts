import { test, expect, type Page } from "@playwright/test";

async function start(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "开始使用", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "便签正文", exact: true })).toBeVisible();
}
async function setMarkdown(page: Page, content: string) {
  await page.getByRole("button", { name: "查看 Markdown", exact: true }).click();
  await page.getByRole("textbox", { name: "Markdown 源码", exact: true }).fill(content);
  await page.getByRole("button", { name: "返回即时编辑", exact: true }).click();
}
async function raw(page: Page) {
  await page.getByRole("button", { name: "查看 Markdown", exact: true }).click();
  const value = await page.getByRole("textbox", { name: "Markdown 源码", exact: true }).inputValue();
  await page.getByRole("button", { name: "返回即时编辑", exact: true }).click();
  return value;
}

test("first launch is one inbox and paper; compact UI and larger type", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  await start(page);
  await expect(page.locator(".folder")).toHaveCount(1);
  await expect(page.locator(".note-tabs button")).toHaveCount(1);
  await expect(page.getByRole("region", { name: "待办纸", exact: true })).toHaveCount(1);
  expect(await page.locator(".note-document").evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(17);
  await expect(page.getByText("保持流动")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "复制 note", exact: true })).toHaveCount(0);
  await page.screenshot({ path: "test-results/desktodo-main.png" });
  expect(errors).toEqual([]);
});

test("markdown input becomes formatted and stays editable with undo, IME and refresh", async ({ page }) => {
  await start(page);
  await page.getByRole("button", { name: "新建便签", exact: true }).click();
  const body = page.getByRole("textbox", { name: "便签正文", exact: true });
  await body.click();
  await page.keyboard.type("# A heading");
  await expect(body.locator("h1")).toHaveText("A heading");
  await page.keyboard.press("Enter");
  await page.keyboard.type("**bold** ");
  await expect(body.locator("strong")).toHaveText("bold");
  // Insert a composed Chinese phrase; input rules must not intercept IME confirmation.
  await body.dispatchEvent("compositionstart", { data: "" });
  await page.keyboard.insertText("中文输入");
  await body.dispatchEvent("compositionend", { data: "中文输入" });
  await expect(body).toContainText("中文输入");
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await page.getByRole("button", { name: "重做", exact: true }).click();
  await expect(body).toContainText("中文输入");
  await expect(page.locator(".save-status")).toHaveText("已保存");
  await page.reload();
  // Default selection is inbox's first note; choose saved second note.
  await page.locator(".note-tabs button").last().click();
  await expect(body.locator("h1")).toHaveText("A heading");
  expect(await raw(page)).toContain("**bold**");
});

test("slash opens at the caret, dismisses on typing/click, and mouse/keyboard insert works", async ({ page }) => {
  await start(page);
  await page.getByRole("button", { name: "新建便签", exact: true }).click();
  const body = page.getByRole("textbox", { name: "便签正文", exact: true });
  await body.click();
  await page.keyboard.type("/");
  const menu = page.getByRole("menu", { name: "插入内容" });
  await expect(menu).toBeVisible();
  const caret = await body.evaluate(el => {
    const range = window.getSelection()!.getRangeAt(0).cloneRange();
    const r = range.getBoundingClientRect();
    return { top: r.bottom, left: r.left, doc: el.getBoundingClientRect().top };
  });
  const box = (await menu.boundingBox())!;
  expect(box.y).toBeGreaterThanOrEqual(caret.top);
  expect(Math.abs(box.x - caret.left)).toBeLessThan(12);
  await page.keyboard.type("a");
  await expect(menu).not.toBeVisible();
  await page.keyboard.press("Control+a"); await page.keyboard.press("Backspace");
  await page.keyboard.type("/");
  await expect(menu).toBeVisible();
  await page.getByRole("menuitem", { name: /待办纸/ }).click();
  await expect(page.getByRole("region", { name: "待办纸", exact: true })).toBeVisible();
  expect(await raw(page)).toContain("```todo");

  // A fresh paragraph can host a second, independent block.
  await body.click(); await page.keyboard.press("Control+End");
  await page.keyboard.type("/");
  await expect(menu).toBeVisible();
  await page.keyboard.press("ArrowDown"); await page.keyboard.press("Enter");
  await expect(page.locator(".katex")).toBeVisible();
  await page.getByRole("textbox", { name: "公式内容" }).fill("\\frac{a}{b}");
  await expect(page.locator(".katex .mfrac")).toBeVisible();
  expect(await raw(page)).toContain("\\frac{a}{b}");
});

test("todo paper edits, adds empty rows, clears only its own tasks, and supports undo", async ({ page }) => {
  await start(page);
  await setMarkdown(page, "```todo\n- [ ] first\n- [x] done\n```\n\n```todo\n- [x] keep\n```\n\n```js\n- [x] literal\n```");
  const papers = page.getByRole("region", { name: "待办纸", exact: true });
  const first = papers.nth(0);
  await first.getByRole("textbox", { name: "待办内容 1", exact: true }).fill("新的任务");
  await first.getByRole("textbox", { name: "待办内容 1", exact: true }).press("Enter");
  await expect(first.getByRole("textbox")).toHaveCount(3);
  await expect(first.getByRole("textbox").nth(1)).toBeFocused();
  await first.getByRole("textbox").nth(1).fill("");
  await expect(first.getByRole("textbox")).toHaveCount(3);
  await first.getByRole("textbox").nth(1).fill("second");
  await first.getByRole("checkbox").first().check();
  await first.getByRole("button", { name: "清除已完成", exact: true }).click();
  await expect(first.getByRole("textbox")).toHaveCount(1);
  await expect(first.getByRole("textbox").first()).toHaveValue("second");
  await expect(papers.nth(1).getByRole("textbox")).toHaveValue("keep");
  await expect(page.locator(".ordinary-code")).toContainText("- [x] literal");
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await expect(first.getByRole("textbox")).toHaveCount(3);
  await first.getByRole("button", { name: "删除待办 2", exact: true }).click();
  await expect(first.getByRole("textbox")).toHaveCount(2);
  await first.getByRole("button", { name: "添加待办", exact: false }).click();
  await first.getByRole("textbox").last().fill("last");
  const md = await raw(page);
  expect(md).toContain("- [x] 新的任务");
  expect(md).toContain("- [ ] last");
  expect(md).toContain("- [x] keep");
  expect(md).toContain("```js");
  await page.reload();
  await expect(page.getByRole("region", { name: "待办纸", exact: true }).first().getByRole("textbox").last()).toHaveValue("last");
});

test("legacy workspace migrates intact; folder creation and switching do not lose edits", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.setItem("desktodo-workspace-v1", JSON.stringify({ clusters: [{ id: "old", name: "旧工作", icon: "✦", color: "#89abcd", notes: [{ id: "note", title: "原便签", content: "# 旧笔记\n\n- [ ] 待办", color: "#89abcd", updatedAt: 123 }] }] })));
  await page.reload();
  await page.getByRole("button", { name: "迁入便签并开始", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "便签标题", exact: true })).toHaveValue("原便签");
  await expect(page.locator(".note-document h1")).toHaveText("旧笔记");
  await page.getByRole("button", { name: "新建 note 夹", exact: true }).click();
  await page.getByRole("textbox", { name: "Note 夹名称", exact: true }).fill("新工作");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await page.getByRole("textbox", { name: "便签标题", exact: true }).fill("第二张");
  await page.locator(".folder").first().click();
  await expect(page.getByRole("textbox", { name: "便签标题", exact: true })).toHaveValue("原便签");
  await page.locator(".folder").last().click();
  await expect(page.getByRole("textbox", { name: "便签标题", exact: true })).toHaveValue("第二张");
  expect(await page.evaluate(() => localStorage.getItem("desktodo-workspace-v1"))).toContain("旧笔记");
});

test("clipboard copies markdown without making a duplicate; read failure keeps the data", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await start(page);
  await page.getByRole("button", { name: "复制便签内容", exact: true }).click();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toContain("```todo");
  await expect(page.locator(".note-tabs button")).toHaveCount(1);
  await page.evaluate(() => localStorage.setItem("desktodo-workspace-v2", "{ broken"));
  await page.reload();
  await expect(page.getByRole("heading", { name: "暂时无法读取便签" })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("desktodo-workspace-v2"))).toBe("{ broken");
});

