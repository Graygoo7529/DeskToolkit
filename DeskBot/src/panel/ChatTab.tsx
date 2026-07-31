// 对话 tab —— 模仿 kimi TUI：流式打字、工具调用行、权限请求条、状态条（契约 §8/§12）。
import { useCallback, useEffect, useRef, useState } from 'react'
import { chatCancel, chatPermissionResponse, chatSend, useChatEvent } from '../shared/ipc'
import { renderMarkdown } from './markdown'

interface ChatMsg {
  id: number
  role: 'user' | 'assistant' | 'error'
  text: string
}

interface ToolItem {
  id: string
  title: string
  kind?: string
  status: string
  contentText?: string
  open: boolean
}

interface PermissionReq {
  requestId: string
  title: string
  options: { optionId: string; name: string; kind: string }[]
}

interface SessionState {
  status: 'connecting' | 'ready' | 'error'
  message?: string
}

function toolIcon(status: string): { ch: string; cls: string } {
  if (status === 'completed') return { ch: '✓', cls: 'ok' }
  if (status === 'failed') return { ch: '✗', cls: 'bad' }
  return { ch: '⟳', cls: 'run' }
}

export default function ChatTab({ visible }: { visible: boolean }) {
  const [msgs, setMsgs] = useState<ChatMsg[]>([])
  const [tools, setTools] = useState<ToolItem[]>([])
  const [perm, setPerm] = useState<PermissionReq | null>(null)
  const [session, setSession] = useState<SessionState>({ status: 'connecting' })
  const [busy, setBusy] = useState(false)
  const [input, setInput] = useState('')

  const idRef = useRef(0)
  const assistantIdRef = useRef<number | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  // ---------- chat://event → 状态（契约 §8） ----------
  useChatEvent(
    useCallback((ev) => {
      switch (ev.type) {
        case 'session':
          setSession({ status: ev.status, message: ev.message })
          break
        case 'chunk':
          setMsgs((prev) => {
            const aid = assistantIdRef.current
            if (aid != null) {
              const idx = prev.findIndex((m) => m.id === aid)
              if (idx >= 0) {
                const copy = prev.slice()
                copy[idx] = { ...copy[idx], text: copy[idx].text + ev.text }
                return copy
              }
            }
            const id = ++idRef.current
            assistantIdRef.current = id
            return [...prev, { id, role: 'assistant' as const, text: ev.text }]
          })
          break
        case 'tool_call':
          setTools((prev) =>
            prev.some((t) => t.id === ev.toolCallId)
              ? prev.map((t) => (t.id === ev.toolCallId ? { ...t, title: ev.title, kind: ev.kind, status: ev.status } : t))
              : [...prev, { id: ev.toolCallId, title: ev.title, kind: ev.kind, status: ev.status, open: false }],
          )
          break
        case 'tool_call_update':
          setTools((prev) =>
            prev.map((t) =>
              t.id === ev.toolCallId
                ? { ...t, status: ev.status, contentText: ev.contentText ?? t.contentText }
                : t,
            ),
          )
          break
        case 'permission':
          setPerm({ requestId: ev.requestId, title: ev.title, options: ev.options })
          break
        case 'done':
          setBusy(false)
          assistantIdRef.current = null
          break
        case 'error':
          setMsgs((prev) => [...prev, { id: ++idRef.current, role: 'error' as const, text: ev.message }])
          setBusy(false)
          assistantIdRef.current = null
          break
      }
    }, []),
  )

  // 自动滚到底
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [msgs, tools, perm])

  // ---------- 发送 / 停止 / 权限 ----------
  const send = () => {
    const text = input.trim()
    if (!text || busy) return
    setMsgs((prev) => [...prev, { id: ++idRef.current, role: 'user' as const, text }])
    assistantIdRef.current = null
    setBusy(true)
    setInput('')
    chatSend(text).catch((e) => {
      setMsgs((prev) => [...prev, { id: ++idRef.current, role: 'error' as const, text: String(e) }])
      setBusy(false)
    })
  }

  const stop = () => {
    chatCancel().catch(() => {})
  }

  const answerPermission = (optionId: string) => {
    if (!perm) return
    chatPermissionResponse(perm.requestId, optionId).catch(() => {})
    setPerm(null)
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      send()
    }
  }

  const empty = msgs.length === 0 && tools.length === 0

  return (
    <div className="chat-tab" style={{ display: visible ? 'flex' : 'none' }}>
      {/* 会话状态条 */}
      <div className={`chat-status st-${session.status}`}>
        {session.status === 'connecting' && '连接中…'}
        {session.status === 'ready' && '● 已连接'}
        {session.status === 'error' && `连接出错：${session.message ?? '未知错误'}`}
      </div>

      {/* 消息流 */}
      <div className="chat-scroll" ref={scrollRef}>
        {empty && <div className="chat-empty">和 DeskBot 说点什么吧 ~</div>}
        {msgs.map((m) => (
          <div key={m.id} className={`msg msg-${m.role}`}>
            <div className="msg-role">{m.role === 'user' ? '你' : m.role === 'assistant' ? 'DeskBot' : '出错'}</div>
            <div className="msg-body">{m.role === 'assistant' ? renderMarkdown(m.text) : m.text}</div>
          </div>
        ))}
        {tools.map((t) => {
          const icon = toolIcon(t.status)
          return (
            <div key={t.id} className="tool-row">
              <button className="tool-head" onClick={() => setTools((prev) => prev.map((x) => (x.id === t.id ? { ...x, open: !x.open } : x)))}>
                <span className={`tool-icon ${icon.cls}`}>{icon.ch}</span>
                <span className="tool-title">{t.title}</span>
                {t.kind && <span className="tool-kind">{t.kind}</span>}
                <span className="tool-fold">{t.open ? '▾' : '▸'}</span>
              </button>
              {t.open && t.contentText && <pre className="tool-detail">{t.contentText}</pre>}
            </div>
          )
        })}
      </div>

      {/* 权限请求条 */}
      {perm && (
        <div className="perm-bar">
          <div className="perm-title">{perm.title}</div>
          <div className="perm-options">
            {perm.options.map((o) => {
              const cls = o.kind.includes('allow') ? 'perm-allow' : o.kind.includes('reject') ? 'perm-reject' : 'perm-neutral'
              return (
                <button key={o.optionId} className={`perm-btn ${cls}`} onClick={() => answerPermission(o.optionId)}>
                  {o.name}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* 输入区 */}
      <div className="chat-input">
        <textarea
          value={input}
          placeholder={busy ? 'DeskBot 正在回复…' : '说点什么… (Enter 发送，Shift+Enter 换行)'}
          disabled={busy}
          rows={2}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
        />
        {busy ? (
          <button className="send-btn stop" onClick={stop}>
            停止
          </button>
        ) : (
          <button className="send-btn" onClick={send} disabled={!input.trim()}>
            发送
          </button>
        )}
      </div>
    </div>
  )
}
