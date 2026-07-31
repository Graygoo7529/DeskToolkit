// 舞台主组件 —— 宠物渲染、状态机、光泽联动、交互与点击穿透（契约 §4/§5）。
import { useCallback, useEffect, useRef, useState } from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import {
  drawPixels,
  IDLE_BLINK_FRAME,
  PET_FRAMES,
  PET_SCALE,
  PET_SIZE,
  SPRITE_STAR,
  SPRITE_STEAM,
  SPRITE_SWEAT,
  validateFrames,
  type PetState,
} from './pet'
import Balls, { BALL_HOT_REGIONS, type BallId } from './balls'
import Bubble, { pickGreeting } from './bubble'
import { openPanel, quotaRefresh, updateHotRegions, usePetSignal, useQuotaUpdated } from '../shared/ipc'
import type { QuotaInfo } from '../shared/types'

/** 宠物常驻热区：112px 居中，距底 28px（stage 420×420） */
const PET_RECT = { x: 154, y: 280, w: PET_SIZE, h: PET_SIZE }

const CLICK_MS = 120 // 单击/拖拽分界
const HAPPY_MS = 1500
const LAND_MS = 400
const BALLS_AUTO_CLOSE_MS = 8000
const BUBBLE_AUTO_CLOSE_MS = 4000
const SLEEPY_AFTER_MS = 60000
const FPS = 12

// ---------- 额度 → 光泽档位（契约 §4） ----------

type GlossTier = 'gold' | 'normal' | 'dim' | 'gray'

function weeklyPct(q: QuotaInfo | null): number | null {
  if (!q?.weekly || q.weekly.limit <= 0) return null
  return (q.weekly.remaining / q.weekly.limit) * 100
}

function fiveHourUsedPct(q: QuotaInfo | null): number | null {
  if (!q?.fiveHour || q.fiveHour.limit <= 0) return null
  return (q.fiveHour.used / q.fiveHour.limit) * 100
}

function glossTier(q: QuotaInfo | null): GlossTier {
  const pct = weeklyPct(q)
  if (pct == null) return 'normal'
  if (pct > 60) return 'gold'
  if (pct >= 30) return 'normal'
  if (pct >= 10) return 'dim'
  return 'gray'
}

// ---------- 小组件：字符画小画布（星星/汗滴/蒸汽粒子） ----------

function Sprite({ rows, scale, className, style }: { rows: string[]; scale: number; className?: string; style?: React.CSSProperties }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const ctx = ref.current?.getContext('2d')
    if (ctx) drawPixels(ctx, rows, scale)
  }, [rows, scale])
  return (
    <canvas
      ref={ref}
      className={className}
      style={style}
      width={rows[0].length * scale}
      height={rows.length * scale}
    />
  )
}

// ---------- 主组件 ----------

export default function StageApp() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  // React 可见状态（驱动 DOM：气泡/球/光泽）
  const [quota, setQuota] = useState<QuotaInfo | null>(null)
  const [bubble, setBubble] = useState<string | null>(null)
  const [ballsOpen, setBallsOpen] = useState(false)

  // 绘制循环用的可变状态（全部走 ref，避免 12fps 重建）
  const grabbingRef = useRef(false)
  const landingRef = useRef(false)
  const hoveringRef = useRef(false)
  const chatActiveRef = useRef(false)
  const happyUntilRef = useRef(0)
  const lastInteractRef = useRef(Date.now())
  const quotaRef = useRef<QuotaInfo | null>(null)

  const bubbleTimerRef = useRef<number | undefined>(undefined)
  const ballsTimerRef = useRef<number | undefined>(undefined)

  quotaRef.current = quota

  // ---------- 绘制循环：12fps，内含状态机 ----------
  useEffect(() => {
    if (import.meta.env.DEV) {
      const problems = validateFrames()
      if (problems.length) console.warn('[pet] 帧校验失败:\n' + problems.join('\n'))
    }
    const ctx = canvasRef.current?.getContext('2d')
    if (!ctx) return

    let tick = 0
    let frameIdx = 0
    let prevState: PetState | null = null

    const resolveState = (): PetState => {
      const now = Date.now()
      const pct = weeklyPct(quotaRef.current)
      const fiveUsed = fiveHourUsedPct(quotaRef.current)
      // 优先级：grab/land > think/work > alert/overheat > happy > sleepy > idle（契约 §4）
      if (grabbingRef.current) return 'grab'
      if (landingRef.current) return 'land'
      if (chatActiveRef.current) {
        // 对话中：think / work 每 ~2s 交替（思考 ↔ 执行工具）
        return Math.floor(tick / (FPS * 2)) % 2 === 0 ? 'think' : 'work'
      }
      if (fiveUsed != null && fiveUsed >= 90) return 'overheat'
      if (pct != null && pct < 30 && pct >= 10) return 'alert'
      if (now < happyUntilRef.current) return 'happy'
      if (hoveringRef.current) return 'hover'
      // <10% 灰调打瞌睡；或 60s 无交互
      if ((pct != null && pct < 10) || now - lastInteractRef.current > SLEEPY_AFTER_MS) return 'sleepy'
      return 'idle'
    }

    const timer = setInterval(() => {
      tick++
      const state = resolveState()
      if (state !== prevState) {
        frameIdx = 0
        prevState = state
      } else {
        frameIdx++
      }
      let frame: string[]
      if (state === 'idle') {
        // 呼吸 2 帧 + 每 ~3.5s 眨眼 2 帧
        const cycle = tick % (FPS * 3.5)
        if (cycle >= FPS * 3.5 - 2) frame = IDLE_BLINK_FRAME
        else frame = PET_FRAMES.idle[frameIdx % PET_FRAMES.idle.length]
      } else {
        const frames = PET_FRAMES[state]
        frame = frames[frameIdx % frames.length]
      }
      drawPixels(ctx, frame, PET_SCALE)
    }, 1000 / FPS)

    return () => clearInterval(timer)
  }, [])

  // ---------- 事件：pet://signal / quota://updated ----------
  usePetSignal(
    useCallback(({ signal }) => {
      if (signal === 'landed') {
        grabbingRef.current = false
        landingRef.current = true
        setTimeout(() => {
          landingRef.current = false
        }, LAND_MS)
      } else if (signal === 'chat_active') {
        chatActiveRef.current = true
      } else {
        chatActiveRef.current = false
      }
    }, []),
  )

  useQuotaUpdated(
    useCallback((q) => {
      setQuota(q)
    }, []),
  )

  // ---------- 点击穿透：布局变化后上报热区（契约 §5） ----------
  useEffect(() => {
    const regions = ballsOpen ? [{ id: 'pet', ...PET_RECT }, ...BALL_HOT_REGIONS] : [{ id: 'pet', ...PET_RECT }]
    updateHotRegions(regions).catch(() => {})
    // 展开/收起过渡结束后再校准一次
    const t = setTimeout(() => updateHotRegions(regions).catch(() => {}), 320)
    return () => clearTimeout(t)
  }, [ballsOpen])

  // ---------- 气泡与球的自动收起 ----------
  const showBubbleAndBalls = useCallback(() => {
    const pct = weeklyPct(quotaRef.current)
    setBubble(pickGreeting(new Date(), pct))
    setBallsOpen(true)
    clearTimeout(bubbleTimerRef.current)
    bubbleTimerRef.current = window.setTimeout(() => setBubble(null), BUBBLE_AUTO_CLOSE_MS)
    clearTimeout(ballsTimerRef.current)
    ballsTimerRef.current = window.setTimeout(() => setBallsOpen(false), BALLS_AUTO_CLOSE_MS)
  }, [])

  const hideBubbleAndBalls = useCallback(() => {
    setBubble(null)
    setBallsOpen(false)
    clearTimeout(bubbleTimerRef.current)
    clearTimeout(ballsTimerRef.current)
  }, [])

  // ---------- 宠物交互：单击 vs 拖拽 ----------
  const pressTimerRef = useRef<number | undefined>(undefined)
  const draggedRef = useRef(false)

  const onPetMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return
    lastInteractRef.current = Date.now()
    draggedRef.current = false
    clearTimeout(pressTimerRef.current)
    pressTimerRef.current = window.setTimeout(() => {
      // 超过 120ms 未松手 → 拎起并拖拽
      grabbingRef.current = true
      draggedRef.current = true
      getCurrentWindow()
        .startDragging()
        .catch(() => {})
    }, CLICK_MS)
  }

  const onPetMouseUp = () => {
    clearTimeout(pressTimerRef.current)
    lastInteractRef.current = Date.now()
    if (draggedRef.current) return // 拖拽结束，等待 Rust 发 landed
    // 单击：问候气泡 + 球展开/收回，宠物 happy 1.5s
    happyUntilRef.current = Date.now() + HAPPY_MS
    if (ballsOpen) hideBubbleAndBalls()
    else showBubbleAndBalls()
  }

  const onBallActivate = (id: BallId) => {
    lastInteractRef.current = Date.now()
    // 重置 8s 自动收回
    clearTimeout(ballsTimerRef.current)
    ballsTimerRef.current = window.setTimeout(() => setBallsOpen(false), BALLS_AUTO_CLOSE_MS)
    if (id === 'chat') {
      openPanel('chat').catch(() => {})
    } else {
      quotaRefresh()
        .then(setQuota)
        .catch(() => {})
      openPanel('quota').catch(() => {})
    }
  }

  // ---------- 光泽档位与装饰层 ----------
  const tier = glossTier(quota)
  const overheating = (fiveHourUsedPct(quota) ?? 0) >= 90

  return (
    <div className="stage">
      {/* 悬浮球（扇形展开） */}
      <Balls open={ballsOpen} onActivate={onBallActivate} />

      {/* 问候气泡 */}
      {bubble && <Bubble text={bubble} />}

      {/* 宠物 */}
      <div
        className={`pet-wrap tier-${tier}${overheating ? ' overheating' : ''}`}
        style={{ left: PET_RECT.x, top: PET_RECT.y }}
        onMouseDown={onPetMouseDown}
        onMouseUp={onPetMouseUp}
        onMouseEnter={() => {
          hoveringRef.current = true
        }}
        onMouseLeave={() => {
          hoveringRef.current = false
        }}
      >
        <canvas ref={canvasRef} width={PET_SIZE} height={PET_SIZE} className="pet-canvas" />
        {/* >60%：金色星星粒子 */}
        {tier === 'gold' && (
          <>
            <Sprite rows={SPRITE_STAR} scale={2} className="fx-star" style={{ left: -14, top: 22 }} />
            <Sprite rows={SPRITE_STAR} scale={3} className="fx-star d1" style={{ left: 100, top: 6 }} />
            <Sprite rows={SPRITE_STAR} scale={2} className="fx-star d2" style={{ left: 96, top: 70 }} />
          </>
        )}
        {/* 10–30%：汗滴 */}
        {tier === 'dim' && <Sprite rows={SPRITE_SWEAT} scale={2} className="fx-sweat" style={{ left: 96, top: 26 }} />}
        {/* 5h ≥90%：蒸汽 */}
        {overheating && (
          <>
            <Sprite rows={SPRITE_STEAM} scale={2} className="fx-steam" style={{ left: 24, top: -12 }} />
            <Sprite rows={SPRITE_STEAM} scale={2} className="fx-steam d1" style={{ left: 76, top: -12 }} />
          </>
        )}
      </div>
    </div>
  )
}
