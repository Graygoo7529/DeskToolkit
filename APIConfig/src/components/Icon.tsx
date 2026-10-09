import type { CSSProperties } from 'react'

const paths = {
  arrow: 'M5 12h14m-6-6 6 6-6 6',
  plus: 'M12 5v14M5 12h14',
  close: 'm6 6 12 12M18 6 6 18',
  search: 'M10.5 18a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15Zm5.5-2 5 5',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  folder: 'M3 7V5h6l2 2h10v13H3V7Z',
  chevron: 'm9 5 7 7-7 7',
  refresh: 'M20 7v5h-5M4 17v-5h5M5.4 7a8 8 0 0 1 13.2-1L20 8M4 16l1.4 2A8 8 0 0 0 18.6 17',
  check: 'm5 12 4 4L19 6',
  layers: 'm12 3 9 5-9 5-9-5 9-5ZM3 12l9 5 9-5M3 16l9 5 9-5',
  bolt: 'm13 2-9 12h7l-1 8 10-13h-8l1-7Z',
  external: 'M14 5h5v5m0-5-8 8M19 14v5H5V5h5',
} as const

export default function Icon({ name, size = 18, style }: { name: keyof typeof paths; size?: number; style?: CSSProperties }) {
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={name === 'more' ? 4 : 1.7} strokeLinecap="round" strokeLinejoin="round" style={style}><path d={paths[name]} /></svg>
}
