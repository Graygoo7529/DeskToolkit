// 面板主组件 —— 像素风标题栏（拖动/tab/放大还原/关闭）+ 双 tab + 右下 resize 把手（契约 §1）。
import { useCallback, useEffect, useRef, useState } from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { LogicalSize } from '@tauri-apps/api/dpi'
import { closePanel, usePanelTabEvent } from '../shared/ipc'
import type { PanelTab } from '../shared/types'
import ChatTab from './ChatTab'
import QuotaTab from './QuotaTab'
import { drawPixels } from '../stage/pet'

const SMALL = { w: 400, h: 560 }
const BIG = { w: 760, h: 720 }

/** 标题栏小机器人图标 8×8 */
const MINI_BOT = [
  '...YY...',
  '...KK...',
  '.KKKKKK.',
  'KWKWWKWK',
  'KBBBBBBK',
  'KBBKKBBK',
  '.KKKKKK.',
  '.K.K.K..',
]

function MiniBotIcon() {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const ctx = ref.current?.getContext('2d')
    if (ctx) drawPixels(ctx, MINI_BOT, 2)
  }, [])
  return <canvas ref={ref} width={16} height={16} className="brand-icon" />
}

export default function PanelApp() {
  const [tab, setTab] = useState<PanelTab>('chat')
  const [big, setBig] = useState(false)

  // Rust 每次打开 panel 时发 panel://tab（契约 §8）
  usePanelTabEvent(
    useCallback((p) => {
      setTab(p.tab)
    }, []),
  )

  const toggleSize = () => {
    const next = !big
    setBig(next)
    const size = next ? BIG : SMALL
    getCurrentWindow()
      .setSize(new LogicalSize(size.w, size.h))
      .catch(() => {})
  }

  const onResizeMouseDown = (e: React.MouseEvent) => {
    e.preventDefault()
    getCurrentWindow()
      .startResizeDragging('SouthEast')
      .catch(() => {})
  }

  return (
    <div className="panel">
      <header className="titlebar" data-tauri-drag-region>
        <div className="brand">
          <MiniBotIcon />
          <span className="brand-name">DeskBot</span>
        </div>
        <nav className="tabs">
          <button className={`tab-btn${tab === 'chat' ? ' active' : ''}`} onClick={() => setTab('chat')}>
            对话
          </button>
          <button className={`tab-btn${tab === 'quota' ? ' active' : ''}`} onClick={() => setTab('quota')}>
            额度
          </button>
        </nav>
        <div className="win-btns">
          <button className="win-btn" onClick={toggleSize} title={big ? '还原' : '放大'}>
            {big ? '⤡' : '⤢'}
          </button>
          <button className="win-btn close" onClick={() => closePanel().catch(() => {})} title="关闭">
            ✕
          </button>
        </div>
      </header>

      <main className="panel-body">
        {/* 两个 tab 常驻挂载（display 切换），保住聊天状态 */}
        <ChatTab visible={tab === 'chat'} />
        <QuotaTab visible={tab === 'quota'} />
      </main>

      <div className="resize-handle" onMouseDown={onResizeMouseDown} />
    </div>
  )
}
