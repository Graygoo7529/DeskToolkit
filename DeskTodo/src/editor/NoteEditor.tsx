import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { EditorContent, useEditor } from "@tiptap/react";
import { Extension, type Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";
import { TableKit } from "@tiptap/extension-table";
import { TaskList, TaskItem } from "@tiptap/extension-list";
import Image from "@tiptap/extension-image";
import { blockContent, blockPlugins, InteractiveCodeBlock } from "./blocks";
import { desktop } from "../storage";
import "katex/dist/katex.min.css";

const DollarMath = Extension.create({
  name: "dollarMath",
  markdownTokenizer: {
    name: "dollarMath", level: "block",
    start: (src: string) => src.indexOf("$$"),
    tokenize(src: string) {
      const match = /^\$\$\s*\n([\s\S]*?)\n\$\$[ \t]*(?:\n|$)/.exec(src);
      return match ? { type: "dollarMath", raw: match[0], text: match[1] } : undefined;
    },
  },
  parseMarkdown: (token, helpers) => helpers.createNode("codeBlock", { language: "math" }, token.text ? [helpers.createTextNode(token.text)] : []),
});
type Slash = { from: number; to: number; left: number; top: number };
type Props = { content: string; onChange: (content: string) => void; onReady?: (editor: Editor | null) => void };

export default function NoteEditor({ content, onChange, onReady }: Props) {
  const change = useRef(onChange); change.current = onChange;
  const ready = useRef(onReady); ready.current = onReady;
  const [slash, setSlash] = useState<Slash | null>(null);
  const slashRef = useRef<Slash | null>(null);
  const [chosen, setChosen] = useState(0);
  const choice = useRef(0);
  const select = (index: number) => { choice.current = index; setChosen(index); };
  const close = () => { slashRef.current = null; setSlash(null); };
  const editorRef = useRef<Editor | null>(null);
  const insert = (id: string) => {
    const ed = editorRef.current;
    const target = slashRef.current;
    if (!ed || !target) return;
    close();
    ed.chain().focus().insertContentAt({ from: target.from, to: target.to }, blockContent(id)).run();
  };
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ codeBlock: false, link: { openOnClick: false, autolink: true } }),
      InteractiveCodeBlock, TableKit, TaskList, TaskItem.configure({ nested: true }),
      Image.configure({ allowBase64: true }), DollarMath,
      Markdown.configure({ markedOptions: { gfm: true, breaks: true } }),
    ],
    content, contentType: "markdown",
    editorProps: {
      attributes: { class: "note-document", role: "textbox", "aria-label": "便签正文", "aria-multiline": "true", spellcheck: "false" },
      handleTextInput(view, from, to, text) {
        close();
        const parent = view.state.doc.resolve(from);
        // Only an actual slash typed in an empty paragraph opens this menu.
        if (!view.composing && text === "/" && from === to && parent.parent.type.name === "paragraph" && !parent.parent.textContent.trim()) {
          requestAnimationFrame(() => {
            if (!view.hasFocus() || view.state.selection.from !== from + 1 || view.state.doc.textBetween(from, from + 1) !== "/") return;
            const rect = view.coordsAtPos(from + 1);
            const target = { from, to: from + 1, left: Math.max(12, Math.min(rect.left, window.innerWidth - 300)), top: Math.min(rect.bottom + 8, window.innerHeight - 170) };
            slashRef.current = target; setSlash(target); select(0);
          });
        }
        return false;
      },
      handleKeyDown(view, event) {
        if (view.composing || event.isComposing || !slashRef.current) return false;
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          select((choice.current + (event.key === "ArrowDown" ? 1 : blockPlugins.length - 1)) % blockPlugins.length); return true;
        }
        if (event.key === "Enter" || event.key === "Tab") { event.preventDefault(); insert(blockPlugins[choice.current].id); return true; }
        close(); return false;
      },
      handlePaste(_view, event) {
        close();
        const text = event.clipboardData?.getData("text/plain");
        const ed = editorRef.current;
        if (text && ed && !ed.isActive("codeBlock") && !event.clipboardData?.getData("text/html") && /(?:\n|^#{1,6} |^\s*[-*] |\*\*|```)/.test(text)) {
          ed.commands.insertContent(text, { contentType: "markdown" }); return true;
        }
        return false;
      },
      handleClick(_view, _pos, event) {
        close();
        const link = (event.target as HTMLElement).closest("a");
        if (link && (event.ctrlKey || event.metaKey)) {
          const url = link.getAttribute("href") || "";
          if (/^(https?:|mailto:)/i.test(url)) {
            if (desktop) void import("@tauri-apps/plugin-opener").then(({ openUrl }) => openUrl(url));
            else window.open(url, "_blank", "noopener,noreferrer");
          }
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor: ed }) => change.current(ed.getMarkdown()),
    onSelectionUpdate: ({ editor: ed }) => {
      if (slashRef.current && ed.state.selection.from !== slashRef.current.to) close();
    },
    onBlur: close,
  });
  editorRef.current = editor;
  useEffect(() => { ready.current?.(editor); return () => ready.current?.(null); }, [editor]);
  useEffect(() => {
    const dismiss = (event: Event) => {
      if (!(event.target instanceof Element) || !event.target.closest(".slash-menu")) close();
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("scroll", dismiss, true);
    window.addEventListener("resize", close);
    return () => { document.removeEventListener("pointerdown", dismiss); document.removeEventListener("scroll", dismiss, true); window.removeEventListener("resize", close); };
  }, []);
  return <>
    <EditorContent editor={editor} />
    {slash && createPortal(<div role="menu" aria-label="插入内容" className="slash-menu" style={{ left: slash.left, top: slash.top }} onMouseDown={event => event.preventDefault()}>
      <div className="slash-label">插入内容 <kbd>Esc</kbd></div>
      {blockPlugins.map((plugin, index) => <button role="menuitem" className={index === chosen ? "active" : ""} key={plugin.id} onMouseEnter={() => select(index)} onClick={() => insert(plugin.id)}>
        <span className="slash-symbol">{plugin.symbol}</span><span><strong>{plugin.label}</strong><small>{plugin.description}</small></span>
      </button>)}
    </div>, document.body)}
  </>;
}

