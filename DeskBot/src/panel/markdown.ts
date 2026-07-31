// 极简 markdown 渲染（契约 §12：``` 代码块、`inline`、**粗体**、按行列表，不引依赖）。
// 用 React.createElement 实现，保持 .ts 纯逻辑文件。
import { createElement, Fragment, type ReactNode } from 'react'

let keySeq = 0
const nextKey = () => `md-${keySeq++}`

/** 行内解析：`code` 与 **bold** */
function renderInline(text: string): ReactNode[] {
  const out: ReactNode[] = []
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*)/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index))
    if (m[1]) {
      out.push(createElement('code', { key: nextKey(), className: 'md-inline-code' }, m[1].slice(1, -1)))
    } else if (m[2]) {
      out.push(createElement('strong', { key: nextKey() }, m[2].slice(2, -2)))
    }
    last = m.index + m[0].length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

/** 把 markdown 文本渲染为 React 节点树 */
export function renderMarkdown(text: string): ReactNode {
  keySeq = 0
  const lines = text.split('\n')
  const blocks: ReactNode[] = []
  let para: string[] = []
  let list: string[] = []

  const flushPara = () => {
    if (para.length === 0) return
    blocks.push(
      createElement(
        'p',
        { key: nextKey(), className: 'md-p' },
        para.flatMap((l, i) => (i === 0 ? renderInline(l) : [createElement('br', { key: nextKey() }), ...renderInline(l)])),
      ),
    )
    para = []
  }
  const flushList = () => {
    if (list.length === 0) return
    blocks.push(
      createElement(
        'ul',
        { key: nextKey(), className: 'md-ul' },
        list.map((item) => createElement('li', { key: nextKey() }, renderInline(item))),
      ),
    )
    list = []
  }

  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    // ``` 代码块
    if (line.trimStart().startsWith('```')) {
      flushPara()
      flushList()
      const buf: string[] = []
      i++
      while (i < lines.length && !lines[i].trimStart().startsWith('```')) {
        buf.push(lines[i])
        i++
      }
      i++ // 跳过收尾 ```
      blocks.push(createElement('pre', { key: nextKey(), className: 'md-pre' }, createElement('code', null, buf.join('\n'))))
      continue
    }
    // 列表项
    const li = /^\s*[-*]\s+(.*)$/.exec(line)
    if (li) {
      flushPara()
      list.push(li[1])
      i++
      continue
    }
    // 空行分段
    if (line.trim() === '') {
      flushPara()
      flushList()
      i++
      continue
    }
    flushList()
    para.push(line)
    i++
  }
  flushPara()
  flushList()

  return createElement(Fragment, null, blocks)
}
