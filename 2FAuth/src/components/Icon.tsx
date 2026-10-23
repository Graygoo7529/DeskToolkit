const paths = {
  shield: ['M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6l-8-3Z', 'm8.5 12 2.5 2.5 4.5-5'],
  plus: ['M12 5v14', 'M5 12h14'], close: ['m6 6 12 12', 'M6 18 18 6'],
  search: ['M21 21 16 16', 'M10 17a7 7 0 1 0 0-14 7 7 0 0 0 0 14Z'],
  folder: ['M3 7V5h6l2 3h10v12H3V7Z'],
  copy: ['M9 9h11v12H9V9Z', 'M15 9V3H3v12h6'],
  check: ['m5 12 4 4L19 6'],
  star: ['m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9L12 3Z'],
  edit: ['m15 5 4 4', 'm4 16-1 5 5-1L21 7l-4-4L4 16Z'],
  trash: ['M4 7h16', 'm6 7 1 14h10l1-14', 'M9 7V3h6v4', 'M10 11v6', 'M14 11v6'],
  eye: ['M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z', 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z'],
  hide: ['m3 3 18 18', 'M10 5c7-1 12 7 12 7a24 24 0 0 1-4 4', 'M6 6a24 24 0 0 0-4 6s4 7 10 7c2 0 3-.5 4-1'],
  key: ['M14 10a5 5 0 1 0 0-1Z', 'm13 13-9 9-2-2 2-2-2-2 6-6'],
  download: ['M12 3v12', 'm7 10 5 5 5-5', 'M4 16v5h16v-5'],
  upload: ['M12 16V4', 'm7 9 5-5 5 5', 'M4 16v5h16v-5'],
  clock: ['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z', 'M12 6v6l4 2'],
  grid: ['M3 3h7v7H3Z', 'M14 3h7v7h-7Z', 'M3 14h7v7H3Z', 'M14 14h7v7h-7Z'],
  qr: ['M3 3h6v6H3Z', 'M15 3h6v6h-6Z', 'M3 15h6v6H3Z', 'M15 15h3v3h3v3h-6v-6Z', 'M12 3v9H3', 'M12 15v6', 'M21 12h-6'],
  arrow: ['M5 12h14', 'm13 6 6 6-6 6'],
  info: ['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z', 'M12 11v6', 'M12 7h.01'],
} as const
export type IconName = keyof typeof paths
export default function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name].map((d, i) => <path d={d} key={i} />)}</svg>
}
