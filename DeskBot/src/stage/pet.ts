// 宠物像素帧 —— 28×28 字符串字符画 + 调色板（契约 §4）。
// 每帧 28 行、每行 28 字符；'.' 为透明。绘制时整数倍放大（×4 → 112px）。
// 基础帧为 BASE，其余帧用行补丁（patch）在 BASE 上派生，保证风格统一。

export const PET_GRID = 28
export const PET_SCALE = 4
export const PET_SIZE = PET_GRID * PET_SCALE // 112

/** 调色板：字符 → 颜色 */
export const PALETTE: Record<string, string> = {
  K: '#134e4a', // 深青描边
  B: '#5eead4', // 青色身体
  D: '#2dd4bf', // 身体暗部
  W: '#f8fafc', // 眼白 / 蒸汽
  E: '#0f172a', // 瞳孔
  H: '#ffffff', // 高光
  P: '#fda4af', // 腮红
  R: '#fb7185', // 红（过热/危险）
  Y: '#fbbf24', // 黄色天线
  G: '#9ca3af', // 齿轮灰
  S: '#7dd3fc', // 汗滴蓝
  Z: '#c4b5fd', // 睡意 Z
}

// ---------- 基础帧（idle A） ----------
const BASE: string[] = [
  '............YYYY............', // 0  天线球顶
  '...........YHYYYY...........', // 1  天线球（带高光）
  '............YYYY............', // 2  天线球底
  '.............KK.............', // 3  天线杆
  '.............KK.............', // 4
  '.............KK.............', // 5
  '............................', // 6
  '.........KKKKKKKKKK.........', // 7  头顶（阶梯）
  '.......KKKKKKKKKKKKKK.......', // 8
  '......KBBBBBBBBBBBBBBK......', // 9
  '.....KBBBBBBBBBBBBBBBBK.....', // 10
  '.....KBBBBBBBBBBBBBBBBK.....', // 11
  '.....KBB.WW.BBBB.WW.BBK.....', // 12 眼睛 a
  '...KDKBBWWWWBBBBWWWWBBKDK...', // 13 眼睛 b（两侧耳罩）
  '...KDKBBWHEWBBBBWEEWBBKDK...', // 14 眼睛 c（瞳孔+高光）
  '...KDKBBWEEWBBBBWEEWBBKDK...', // 15 眼睛 d
  '...KDKBBWWWWBBBBWWWWBBKDK...', // 16 眼睛 e
  '.....KBB.WW.BBBB.WW.BBK.....', // 17 眼睛 f
  '.....KPPBBBBBBBBBBBBPPK.....', // 18 腮红
  '.....KPPBBBBBBBBBBBBPPK.....', // 19
  '.....KBBBBBBKBBKBBBBBBK.....', // 20 嘴巴（微笑）
  '.....KBBBBBBBKKBBBBBBBK.....', // 21
  '.....KBBBBBBBBBBBBBBDDK.....', // 22 暗部
  '.....KBBBBBBBBBBBBBBBBK.....', // 23
  '......KKKKKKKKKKKKKKKK......', // 24 身体底
  '........KBBK....KBBK........', // 25 小脚
  '........KBBK....KBBK........', // 26
  '........KKKK....KKKK........', // 27
]

/** 行补丁：返回新帧 */
function patch(base: string[], rows: Record<number, string>): string[] {
  const f = base.slice()
  for (const k of Object.keys(rows)) f[Number(k)] = rows[Number(k)]
  return f
}

// 闭眼笑弧（眼睛变成 ∪ 形），think 之外多个状态复用
const CLOSED_EYES: Record<number, string> = {
  13: '...KDKBB....BBBB....BBKDK...',
  14: '...KDKBB....BBBB....BBKDK...',
  15: '...KDKBBK..KBBBBK..KBBKDK...',
  16: '...KDKBB.KK.BBBB.KK.BBKDK...',
}

// ---------- 各状态帧 ----------

/** idle B：整体下沉 1px（顶部削掉一行、脚部重复底行），形成呼吸挤压感 */
const IDLE_B = BASE.slice(1).concat([BASE[27]])

const IDLE_BLINK = patch(BASE, CLOSED_EYES)

const HOVER = patch(BASE, {
  8: '...Y...KKKKKKKKKKKKKK...Y...', // 两侧小星星
  14: '...KDKBBWHHWBBBBWHHWBBKDK...', // 高光变大，眼睛更亮
})

const GRAB = patch(BASE, {
  // 眼睛朝上（瞳孔上移）
  13: '...KDKBBWHEWBBBBWEEWBBKDK...',
  14: '...KDKBBWEEWBBBBWEEWBBKDK...',
  15: '...KDKBBWWWWBBBBWWWWBBKDK...',
  16: '...KDKBB.WW.BBBB.WW.BBKDK...',
  // 手臂下垂（耳罩下方延伸）
  17: '...KDKBBBBBBBBBBBBBBBBKDK...',
  18: '...KDKPPBBBBBBBBBBBBPPKDK...',
  19: '....KKBBBBBBBBBBBBBBBBKK....',
  // 张嘴 O（被拎起的惊讶）
  20: '.....KBBBBBBBKKBBBBBBBK.....',
  21: '.....KBBBBBBBKKBBBBBBBK.....',
  // 双腿并拢下垂
  25: '.........KK......KK.........',
  26: '.........KK......KK.........',
})

const LAND = patch(BASE, {
  // 压扁：头顶两行削平，身体横向加宽
  7: '............................',
  8: '............................',
  9: '....KKKKKKKKKKKKKKKKKKKK....',
  10: '...KBBBBBBBBBBBBBBBBBBBBK...',
  11: '...KBBBBBBBBBBBBBBBBBBBBK...',
  12: '...KBBBB.WW.BBBB.WW.BBBBK...',
  13: '...KBBBBWWWWBBBBWWWWBBBBK...',
  14: '...KBBBBK..KBBBBK..KBBBBK...', // > < 挤压眼
  15: '...KBBBB.KK.BBBB.KK.BBBBK...',
  16: '...KBBBB....BBBB....BBBBK...',
  17: '...KBBBBBBBBBBBBBBBBBBBBK...',
  18: '...KPPBBBBBBBBBBBBBBBBPPK...',
  19: '...KPPBBBBBBBBBBBBBBBBPPK...',
  20: '...KBBBBBBBKKKKKKBBBBBBBK...', // 被压平的嘴
  21: '...KBBBBBBBBBBBBBBBBBBBBK...',
  22: '...KBBBBBBBBBBBBBBBBBBDDK...',
  23: '...KBBBBBBBBBBBBBBBBBBBBK...',
  24: '....KKKKKKKKKKKKKKKKKKKK....',
  25: '.....KBBK..........KBBK.....', // 脚外八
  26: '.....KBBK..........KBBK.....',
  27: '.....KKKK..........KKKK.....',
})

const HAPPY = patch(BASE, {
  ...CLOSED_EYES,
  // 右手举起挥手
  9: '......KBBBBBBBBBBBBBBK.KKK..',
  10: '.....KBBBBBBBBBBBBBBBBKKKK..',
  11: '.....KBBBBBBBBBBBBBBBBK.K...',
  // 开口笑
  20: '.....KBBBBBBKBBBKBBBBBK.....',
  21: '.....KBBBBBBBKKKBBBBBBK.....',
})

// think A：眼睛向右斜看，右上方一个黄色「?」
const THINK_A = patch(BASE, {
  1: '...........YHYYYY......YYY..',
  2: '............YYYY.........Y..',
  3: '.............KK.........Y...',
  5: '.............KK.........Y...',
  14: '...KDKBBWWEEBBBBWWEEBBKDK...',
  15: '...KDKBBWWEEBBBBWWEEBBKDK...',
})

// think B：眼睛向左斜看，「?」上移一格（跳动感）
const THINK_B = patch(BASE, {
  0: '............YYYY.......YYY..',
  1: '...........YHYYYY........Y..',
  2: '............YYYY........Y...',
  3: '.............KK.............',
  4: '.............KK.........Y...',
  5: '.............KK.............',
  14: '...KDKBBEEWWBBBBEEWWBBKDK...',
  15: '...KDKBBEEWWBBBBEEWWBBKDK...',
})

// work：眼睛向下专注，右侧悬浮齿轮（两帧旋转）
const WORK_EYES: Record<number, string> = {
  14: '...KDKBBWWWWBBBBWWWWBBKDK...',
  15: '...KDKBBWEEWBBBBWEEWBBKDK...',
}
const WORK_A = patch(BASE, {
  ...WORK_EYES,
  16: '...KDKBBWEEWBBBBWEEWBBK.G.G.',
  17: '.....KBB.WW.BBBB.WW.BBKGGGGG',
  18: '.....KPPBBBBBBBBBBBBPPK.GGG.',
  19: '.....KPPBBBBBBBBBBBBPPKGGGGG',
  20: '.....KBBBBBBKBBKBBBBBBK.G.G.',
})
const WORK_B = patch(BASE, {
  ...WORK_EYES,
  16: '...KDKBBWEEWBBBBWEEWBBKG...G',
  17: '.....KBB.WW.BBBB.WW.BBK.GGG.',
  18: '.....KPPBBBBBBBBBBBBPPK.GGG.',
  19: '.....KPPBBBBBBBBBBBBPPK.GGG.',
  20: '.....KBBBBBBKBBKBBBBBBKG...G',
})

// sleepy A：闭眼 + 一颗 Z
const SLEEPY_A = patch(BASE, {
  ...CLOSED_EYES,
  5: '.............KK........ZZZ..',
  6: '........................Z...',
  7: '.........KKKKKKKKKK....ZZZ..',
})
// sleepy B：闭眼 + 两颗 Z（一大一小）
const SLEEPY_B = patch(BASE, {
  ...CLOSED_EYES,
  3: '.............KK.........ZZZ.',
  4: '.............KK..........Z..',
  5: '.............KK.........ZZZ.',
  7: '.........KKKKKKKKKK.ZZZ.....',
  8: '.......KKKKKKKKKKKKKK.Z.....',
  9: '......KBBBBBBBBBBBBBZZZ.....',
})

// alert：右上方汗滴 + 波浪嘴（紧张）
const ALERT = patch(BASE, {
  8: '.......KKKKKKKKKKKKKK...S...',
  9: '......KBBBBBBBBBBBBBBK.SSS..',
  10: '.....KBBBBBBBBBBBBBBBBKSSS..',
  11: '.....KBBBBBBBBBBBBBBBBK.S...',
  20: '.....KBBBBBBKBKBKBBBBBK.....',
  21: '.....KBBBBBBBBBBBBBBBBK.....',
})

// overheat：头顶蒸汽 + 脸红 + 闭眼用力
const OVERHEAT = patch(BASE, {
  ...CLOSED_EYES,
  0: '........WW........WW........',
  1: '.......W...YHYYYY...W.......',
  2: '........W...YYYY...W........',
  3: '.........W...KK...W.........',
  4: '.........W...KK.............',
  5: '.............KK...W.........',
  18: '.....KRRBBBBBBBBBBBBRRK.....',
  19: '.....KRRBBBBBBBBBBBBRRK.....',
})

// ---------- 帧表 ----------

export type PetState =
  | 'idle'
  | 'hover'
  | 'grab'
  | 'land'
  | 'happy'
  | 'think'
  | 'work'
  | 'sleepy'
  | 'alert'
  | 'overheat'

/** 状态 → 帧序列（12fps 轮播）。idle 的眨眼由 StageApp 周期性替换为 idleBlink。 */
export const PET_FRAMES: Record<PetState, string[][]> = {
  idle: [BASE, IDLE_B],
  hover: [HOVER],
  grab: [GRAB],
  land: [LAND],
  happy: [HAPPY],
  think: [THINK_A, THINK_B],
  work: [WORK_A, WORK_B],
  sleepy: [SLEEPY_A, SLEEPY_B],
  alert: [ALERT],
  overheat: [OVERHEAT],
}

export const IDLE_BLINK_FRAME = IDLE_BLINK

// ---------- 装饰小图（光泽联动的粒子/汗滴/蒸汽，契约 §4） ----------

/** 星星粒子 5×5 */
export const SPRITE_STAR = ['..Y..', '.YYY.', 'YYYYY', '.YYY.', '..Y..']

/** 汗滴 5×7 */
export const SPRITE_SWEAT = ['..S..', '..S..', '.SSS.', '.SSS.', 'SSSSS', 'SSSSS', '.SSS.']

/** 蒸汽缕 3×7 */
export const SPRITE_STEAM = ['.W.', 'W..', '.W.', '..W', '.W.', 'W..', '.W.']

// ---------- 绘制 ----------

/** 把字符画绘制到 canvas 上（整数倍放大，像素风） */
export function drawPixels(
  ctx: CanvasRenderingContext2D,
  rows: string[],
  scale: number,
  palette: Record<string, string> = PALETTE,
): void {
  ctx.clearRect(0, 0, rows[0].length * scale, rows.length * scale)
  for (let y = 0; y < rows.length; y++) {
    const row = rows[y]
    for (let x = 0; x < row.length; x++) {
      const ch = row[x]
      if (ch === '.') continue
      const color = palette[ch]
      if (!color) continue
      ctx.fillStyle = color
      ctx.fillRect(x * scale, y * scale, scale, scale)
    }
  }
}

/** 开发期校验：帧尺寸与调色板字符（构建产物中无副作用） */
export function validateFrames(): string[] {
  const problems: string[] = []
  const check = (name: string, rows: string[], w: number, h: number) => {
    if (rows.length !== h) problems.push(`${name}: ${rows.length} 行，应为 ${h}`)
    rows.forEach((r, i) => {
      if (r.length !== w) problems.push(`${name} 第 ${i} 行: 宽 ${r.length}，应为 ${w}`)
      for (const ch of r) {
        if (ch !== '.' && !PALETTE[ch]) problems.push(`${name} 第 ${i} 行: 未知字符 '${ch}'`)
      }
    })
  }
  for (const [state, frames] of Object.entries(PET_FRAMES)) {
    frames.forEach((f, i) => check(`${state}[${i}]`, f, PET_GRID, PET_GRID))
  }
  check('idleBlink', IDLE_BLINK_FRAME, PET_GRID, PET_GRID)
  check('star', SPRITE_STAR, 5, 5)
  check('sweat', SPRITE_SWEAT, 5, 7)
  check('steam', SPRITE_STEAM, 3, 7)
  return problems
}
