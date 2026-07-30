import { invoke } from '@tauri-apps/api/core'
import type { State } from './types'

export const getState = () => invoke<State>('get_state')

export const saveHome = (originalName: string | null, name: string, location: string) =>
  invoke<State>('save_home', { originalName, name, location })

export const deleteHome = (name: string) => invoke<State>('delete_home', { name })

export const saveProvider = (originalName: string | null, name: string, url: string, key: string) =>
  invoke<State>('save_provider', { originalName, name, url, key })

export const deleteProvider = (name: string) => invoke<State>('delete_provider', { name })

export const applyProvider = (homeName: string, providerName: string) =>
  invoke<State>('apply_provider', { homeName, providerName })

export const openDataDir = () => invoke<void>('open_data_dir')
