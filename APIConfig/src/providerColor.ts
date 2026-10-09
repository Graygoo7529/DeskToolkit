import type { CSSProperties } from 'react'
import type { Provider } from './types'

export function providerStyle(provider?: Provider | null): CSSProperties | undefined {
  if (!provider) return undefined
  const color = /^#[0-9a-f]{6}$/i.test(provider.color) ? provider.color : '#A7B8EF'
  return { '--provider-color': color } as CSSProperties
}
