import { useMemo, useRef, type ComponentType, type KeyboardEvent } from "react";
import type { JSONContent } from "@tiptap/core";
import CodeBlock from "@tiptap/extension-code-block";
import { NodeViewWrapper, NodeViewContent, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import { closeHistory } from "@tiptap/pm/history";
import katex from "katex";

export type BlockProps = { text: string; replace: (text: string, separate?: boolean) => void; remove: () => void; undo: () => void; redo: () => void };
type BlockPlugin = {
  id: string; label: string; description: string; symbol: string; initial: string;
  View: ComponentType<BlockProps>;
};

type TodoLine = { text: string; done: boolean; task: boolean };
export function parseTodos(text: string): TodoLine[] {
  if (!text) return [];
  return text.split("\n").map(line => {
    const match = line.match(/^\s*[-*+]\s+\[([ xX])\](?:[ \t](.*))?$/);
    return match ? { task: true, done: match[1].toLowerCase() === "x", text: match[2] || "" } : { task: false, done: false, text: line };
  });
}
const serializeTodos = (rows: TodoLine[]) => rows.map(row => row.task ? "- [" + (row.done ? "x" : " ") + "] " + row.text : row.text).join("\n");

function TodoPaper({ text, replace, remove, undo, redo }: BlockProps) {
  const rows = parseTodos(text);
  const inputs = useRef<Map<number, HTMLInputElement>>(new Map());
  const tasks = rows.filter(row => row.task);
  const done = tasks.filter(row => row.done).length;
  const commit = (next: TodoLine[], separate = false) => replace(serializeTodos(next), separate);
  const focusRow = (index: number) => requestAnimationFrame(() => inputs.current.get(index)?.focus());
  const add = (after = rows.length - 1) => {
    const next = [...rows];
    next.splice(after + 1, 0, { task: true, done: false, text: "" });
    commit(next, true); focusRow(after + 1);
  };
  const edit = (index: number, value: string) => commit(rows.map((row, i) => i === index ? { ...row, text: value } : row));
  const erase = (index: number) => { commit(rows.filter((_, i) => i !== index), true); focusRow(Math.max(0, index - 1)); };
  const keys = (event: KeyboardEvent<HTMLInputElement>, index: number) => {
    if (event.nativeEvent.isComposing) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
      event.preventDefault(); event.stopPropagation(); event.shiftKey ? redo() : undo(); return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") {
      event.preventDefault(); event.stopPropagation(); redo(); return;
    }
    if (event.key === "Enter") { event.preventDefault(); add(index); }
    if (event.key === "Backspace" && !rows[index].text) { event.preventDefault(); erase(index); }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      const next = index + (event.key === "ArrowDown" ? 1 : -1);
      if (inputs.current.has(next)) { event.preventDefault(); focusRow(next); }
    }
  };
  return <section className="todo-paper" aria-label="待办纸">
    <header className="paper-head"><span className="paper-glyph">✓</span><strong>待办纸</strong><span className="paper-count">{done} / {tasks.length}</span>
      <div className="paper-actions"><button disabled={!done} onClick={() => commit(rows.filter(row => !(row.task && row.done)), true)}>清除已完成</button><button title="删除待办纸（可撤销）" aria-label="删除待办纸" onClick={remove}>×</button></div>
    </header>
    <div className="paper-progress"><i style={{ width: tasks.length ? (done / tasks.length * 100) + "%" : "0%" }} /></div>
    <div className="paper-rows">
      {rows.map((row, index) => row.task
        ? <div className={"paper-row" + (row.done ? " completed" : "")} key={index}>
            <input type="checkbox" aria-label={"完成待办 " + (index + 1)} checked={row.done} onChange={() => commit(rows.map((r, i) => i === index ? { ...r, done: !r.done } : r), true)} />
            <input className="task-text" ref={element => { if (element) inputs.current.set(index, element); else inputs.current.delete(index); }}
              aria-label={"待办内容 " + (index + 1)} placeholder="写下下一步…" value={row.text} onChange={event => edit(index, event.target.value)} onKeyDown={event => keys(event, index)}
              onPaste={event => {
                const pasted = event.clipboardData.getData("text/plain");
                if (!/[\r\n]/.test(pasted)) return;
                event.preventDefault();
                const input = event.currentTarget;
                const merged = row.text.slice(0, input.selectionStart || 0) + pasted + row.text.slice(input.selectionEnd || 0);
                const inserted = merged.replace(/\r/g, "").split("\n").map(line => ({ task: true, done: false, text: line }));
                const next = [...rows]; next.splice(index, 1, ...inserted); commit(next, true); focusRow(index + inserted.length - 1);
              }} />
            <button className="row-delete" aria-label={"删除待办 " + (index + 1)} onClick={() => erase(index)}>×</button>
          </div>
        : <div className="paper-annotation" key={index}>{row.text || "\u00a0"}</div>)}
    </div>
    <button className="paper-add" onClick={() => add()}><span>＋</span> 添加待办 <kbd>Enter</kbd></button>
  </section>;
}

function FormulaPaper({ text, replace, remove, undo, redo }: BlockProps) {
  const html = useMemo(() => katex.renderToString(text || "\\quad", { displayMode: true, throwOnError: false, trust: false, strict: "ignore" }), [text]);
  return <section className="formula-paper" aria-label="公式块">
    <header className="paper-head"><span className="paper-glyph">ƒ</span><strong>公式</strong><button className="row-delete" aria-label="删除公式" onClick={remove}>×</button></header>
    <div className="formula-output" dangerouslySetInnerHTML={{ __html: html }} />
    <textarea aria-label="公式内容" value={text} onChange={event => replace(event.target.value)} spellCheck={false} rows={2}
      onKeyDown={event => {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") { event.preventDefault(); event.stopPropagation(); event.shiftKey ? redo() : undo(); }
      }} />
  </section>;
}

// New block integrations add a renderer and command here. Markdown remains the storage contract.
export const blockPlugins: BlockPlugin[] = [
  { id: "todo", label: "待办纸", description: "记录、勾选和整理下一步", symbol: "☑", initial: "- [ ] ", View: TodoPaper },
  { id: "math", label: "公式", description: "输入 LaTeX，即时显示公式", symbol: "ƒx", initial: "E = mc^2", View: FormulaPaper },
];
export function blockContent(id: string): JSONContent[] {
  const plugin = blockPlugins.find(item => item.id === id)!;
  return [{ type: "codeBlock", attrs: { language: id }, content: [{ type: "text", text: plugin.initial }] }, { type: "paragraph" }];
}
function BlockView(props: NodeViewProps) {
  const { node, editor, getPos, deleteNode } = props;
  const plugin = blockPlugins.find(item => item.id === node.attrs.language);
  const replace = (text: string, separate = false) => {
    const pos = getPos();
    if (pos === undefined) return;
    const current = editor.state.doc.nodeAt(pos);
    if (!current) return;
    let tr = editor.state.tr;
    if (separate) tr = closeHistory(tr);
    tr = tr.replaceWith(pos + 1, pos + 1 + current.content.size, text ? editor.schema.text(text) : []);
    editor.view.dispatch(tr);
    if (separate) editor.view.dispatch(closeHistory(editor.state.tr));
  };
  return <NodeViewWrapper className={"block-node" + (props.selected ? " selected-block" : "")}>
    {plugin ? <>
      <div contentEditable={false}>
        <plugin.View text={node.textContent} replace={replace}
          remove={() => { editor.view.dispatch(closeHistory(editor.state.tr)); deleteNode(); }}
          undo={() => editor.commands.undo()} redo={() => editor.commands.redo()} />
      </div>
      <NodeViewContent style={{ display: "none" }} />
    </> : <div className="ordinary-code">
      <span contentEditable={false} className="code-language">{node.attrs.language || "code"}</span>
      <pre><NodeViewContent /></pre>
    </div>}
  </NodeViewWrapper>;
}
export const InteractiveCodeBlock = CodeBlock.extend({
  addNodeView() { return ReactNodeViewRenderer(BlockView); },
  renderMarkdown(node) {
    const text = (node.content || []).map(child => child.text || "").join("");
    // A longer fence protects literal triple-backticks inside code or a todo label.
    const longest = Math.max(2, ...(text.match(/`+/g) || []).map(run => run.length));
    const fence = "`".repeat(longest + 1);
    return fence + (node.attrs?.language || "") + "\n" + text + "\n" + fence;
  },
});
