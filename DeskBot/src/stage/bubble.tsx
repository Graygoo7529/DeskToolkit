// 问候气泡 —— 像素风气泡框 + 时段/额度加权台词库 + 打字机效果（契约 §4）。
import { useEffect, useState } from 'react'

// ---------- 台词库（≥15 条） ----------

/** 按时段 */
const LINES_MORNING = [
  '早上好呀！新的一天，电量满满 ~',
  '早安！今天的代码也会一次通过吗？',
  '太阳晒屁股啦，开工开工！',
]
const LINES_NOON = ['中午好～记得按时吃饭哦', '午饭时间到！先吃饱再写 bug，啊不，写代码']
const LINES_AFTERNOON = ['下午好呀，喝口水休息一下吧', '下午犯困时间，要不要我陪你聊两句？']
const LINES_EVENING = ['晚上好～今天也辛苦了！', '夜幕降临，效率翻倍时间到？', '晚饭吃了吗？别饿着肚子加班哦']
const LINES_LATE = ['这么晚还没睡呀……要注意休息哦', '深夜模式启动，我陪你安静地待会儿', '月亮都睡了，你也早点休息吧 ~']

/** 任意时段 */
const LINES_ANY = [
  '戳我一下，开心一整天！',
  '我是 DeskBot，你的桌面小助手 ~',
  '今天也要加油鸭！',
  '想聊天就点对话球哦，我随时都在',
]

/** 额度状态 */
const LINES_QUOTA_LOW = ['额度快见底了……省着点用哦', '呜呜，本周额度不多了', '主人，记得看看额度球呀！']
const LINES_QUOTA_RICH = ['额度充足，随便聊！', '满血状态！有什么活儿尽管吩咐 ~']

type TimeSlot = 'morning' | 'noon' | 'afternoon' | 'evening' | 'late'

function timeSlot(hour: number): TimeSlot {
  if (hour >= 5 && hour < 11) return 'morning'
  if (hour >= 11 && hour < 14) return 'noon'
  if (hour >= 14 && hour < 18) return 'afternoon'
  if (hour >= 18 && hour < 23) return 'evening'
  return 'late'
}

const SLOT_LINES: Record<TimeSlot, string[]> = {
  morning: LINES_MORNING,
  noon: LINES_NOON,
  afternoon: LINES_AFTERNOON,
  evening: LINES_EVENING,
  late: LINES_LATE,
}

/**
 * 加权随机选一条台词。
 * @param weeklyPct 周额度剩余百分比（null 表示无数据）
 */
export function pickGreeting(now: Date, weeklyPct: number | null): string {
  const pool: { line: string; weight: number }[] = []
  for (const l of SLOT_LINES[timeSlot(now.getHours())]) pool.push({ line: l, weight: 3 })
  for (const l of LINES_ANY) pool.push({ line: l, weight: 1 })
  if (weeklyPct != null && weeklyPct < 30) {
    for (const l of LINES_QUOTA_LOW) pool.push({ line: l, weight: 3 })
  } else if (weeklyPct != null && weeklyPct > 60) {
    for (const l of LINES_QUOTA_RICH) pool.push({ line: l, weight: 3 })
  }
  const total = pool.reduce((s, p) => s + p.weight, 0)
  let roll = Math.random() * total
  for (const p of pool) {
    roll -= p.weight
    if (roll <= 0) return p.line
  }
  return pool[pool.length - 1].line
}

// ---------- 组件 ----------

const TYPE_INTERVAL = 55 // 打字机逐字间隔 ms

export interface BubbleProps {
  text: string
}

export default function Bubble({ text }: BubbleProps) {
  const [shown, setShown] = useState(0)

  useEffect(() => {
    setShown(0)
    const timer = setInterval(() => {
      setShown((n) => {
        if (n >= text.length) {
          clearInterval(timer)
          return n
        }
        return n + 1
      })
    }, TYPE_INTERVAL)
    return () => clearInterval(timer)
  }, [text])

  const typing = shown < text.length

  return (
    <div className="bubble">
      <span className="bubble-text">
        {text.slice(0, shown)}
        {typing && <span className="bubble-caret" />}
      </span>
    </div>
  )
}
