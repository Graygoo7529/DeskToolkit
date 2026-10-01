import { invoke } from '@tauri-apps/api/core'
import type { State, Scene, ProbeTask, ProbeResult, InspectionSettings } from './types'

export const getState = () => invoke<State>('get_state')

export const saveHome = (originalName: string | null, name: string, location: string) =>
  invoke<State>('save_home', { originalName, name, location })

export const deleteHome = (name: string) => invoke<State>('delete_home', { name })

export const saveProvider = (originalName: string | null, name: string, url: string, key: string) =>
  invoke<State>('save_provider', { originalName, name, url, key })

export const deleteProvider = (name: string) => invoke<State>('delete_provider', { name })

export const applyProvider = (homeName: string, providerName: string) =>
  invoke<State>('apply_provider', { homeName, providerName })

export const saveClaudeHome = (originalName: string | null, name: string, location: string) =>
  invoke<State>('save_claude_home', { originalName, name, location })

export const deleteClaudeHome = (name: string) => invoke<State>('delete_claude_home', { name })

export const saveClaudeProvider = (
  originalName: string | null,
  name: string,
  url: string,
  key: string,
) => invoke<State>('save_claude_provider', { originalName, name, url, key })

export const deleteClaudeProvider = (name: string) =>
  invoke<State>('delete_claude_provider', { name })

export const applyClaudeProvider = (homeName: string, providerName: string) =>
  invoke<State>('apply_claude_provider', {
    claudeHomeName: homeName,
    claudeProviderName: providerName,
  })

export const openDataDir = () => invoke<void>('open_data_dir')

export const inspectProvider = (scene: Scene, name: string, task: ProbeTask) =>
  invoke<ProbeResult>('inspect_provider', { scene, name, task })

export const saveInspection = (scene: Scene, name: string, settings: InspectionSettings) =>
  invoke<State>('save_inspection', { scene, name, settings })

export const reorderItems = (scene: Scene, kind: 'providers' | 'homes', names: string[]) =>
  invoke<State>('reorder_items', { scene, kind, names })
