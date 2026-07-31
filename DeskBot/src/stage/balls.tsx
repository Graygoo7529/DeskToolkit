// 悬浮球 —— 注册表式（契约 §6）。图标为 12×12 字符画，×4 放大成 48px。
import { useEffect, useRef } from 'react'
import { drawPixels, PALETTE } from './pet'
import type { HotRegion } from '../shared/types'

export const BALL_SIZE = 56
const ICON_GRID = 12
const ICON_SCALE = 4

/** 宠物中心（stage 420×420 中，宠物 112px 居中、距底 28px） */
export const PET_CENTER = { x: 210, y: 336 }
const FAN_RADIUS = 110

// ---------- 图标字符画 ----------

/** 对话气泡图标 */
const ICON_CHAT = [
  '............',
  '.KKKKKKKKKK.',
  'KBBBBBBBBBBK',
  'KBKKKKKKKBBK',
  'KBBBBBBBBBBK',
  'KBKKKKKBBBBK',
  'KBBBBBBBBBBK',
  'KBBBBBBBBBBK',
  '.KKKKKKKKKK.',
  '...KK.......',
  '...K........',
  '............',
]

/** 电池图标（~60% 电量） */
const ICON_QUOTA = [
  '............',
  '............',
  'KKKKKKKKKK..',
  'KYYYYYYKKKK.',
  'KYYYYYYKKKKK',
  'KYYYYYYKKKKK',
  'KYYYYYYKKKKK',
  'KYYYYYYKKKKK',
  'KYYYYYYKKKK.',
  'KKKKKKKKKK..',
  '............',
  '............',
]

// ---------- 注册表 ----------

export type BallId = 'chat' | 'quota'

export interface BallSpec {
  id: BallId
  tooltip: string
  icon: string[]
  /** 扇形角度（从正右方起算，逆时针） */
  angle: number
  /** 球左上角坐标（展开时） */
  x: number
  y: number
}

function ballPosition(angleDeg: number): { x: number; y: number } {
  const rad = (angleDeg * Math.PI) / 180
  const cx = PET_CENTER.x + FAN_RADIUS * Math.cos(rad)
  const cy = PET_CENTER.y - FAN_RADIUS * Math.sin(rad)
  return { x: Math.round(cx - BALL_SIZE / 2), y: Math.round(cy - BALL_SIZE / 2) }
}

function makeSpec(id: BallId, tooltip: string, icon: string[], angle: number): BallSpec {
  const { x, y } = ballPosition(angle)
  return { id, tooltip, icon, angle, x, y }
}

export const BALL_SPECS: BallSpec[] = [
  makeSpec('chat', '和 DeskBot 聊天', ICON_CHAT, 150),
  makeSpec('quota', '查看额度', ICON_QUOTA, 110),
]

/** 展开状态下的热区（契约 §5：球只在展开时注册） */
export const BALL_HOT_REGIONS: HotRegion[] = BALL_SPECS.map((b) => ({
  id: `ball-${b.id}`,
  x: b.x,
  y: b.y,
  w: BALL_SIZE,
  h: BALL_SIZE,
}))

// ---------- 组件 ----------

function BallIcon({ rows }: { rows: string[] }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const ctx = ref.current?.getContext('2d')
    if (ctx) drawPixels(ctx, rows, ICON_SCALE, PALETTE)
  }, [rows])
  return <canvas ref={ref} width={ICON_GRID * ICON_SCALE} height={ICON_GRID * ICON_SCALE} />
}

export interface BallsProps {
  open: boolean
  onActivate: (id: BallId) => void
}

export default function Balls({ open, onActivate }: BallsProps) {
  return (
    <>
      {BALL_SPECS.map((b, i) => {
        // 收起时缩回宠物中心并消失；展开时 stagger 弹入
        const collapseX = PET_CENTER.x - (b.x + BALL_SIZE / 2)
        const collapseY = PET_CENTER.y - (b.y + BALL_SIZE / 2)
        const style: React.CSSProperties = {
          left: b.x,
          top: b.y,
          transitionDelay: `${i * 80}ms`,
          transform: open
            ? 'translate(0px, 0px) scale(1)'
            : `translate(${collapseX}px, ${collapseY}px) scale(0)`,
          pointerEvents: open ? 'auto' : 'none',
        }
        return (
          <div
            key={b.id}
            className={`ball${open ? ' open' : ''}`}
            style={style}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => onActivate(b.id)}
          >
            <div className="ball-inner">
              <BallIcon rows={b.icon} />
              <div className="ball-tip">{b.tooltip}</div>
            </div>
          </div>
        )
      })}
    </>
  )
}
