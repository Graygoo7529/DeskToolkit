import { invoke } from '@tauri-apps/api/core'
import type { State, Scene, ProbeTask, ProbeResult, InspectionSettings, ApiAccount, ApiProbeResult, ApiEndpoint, ApiQuotaSettings, ApiProbeProfile } from './types'

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
export const changeDataDir = (path: string, mode: 'copy' | 'existing') => invoke<State>('change_data_dir', { path, mode })

export const inspectProvider = (scene: Scene, name: string, task: ProbeTask) =>
  invoke<ProbeResult>('inspect_provider', { scene, name, task })

export const saveInspection = (scene: Scene, name: string, settings: InspectionSettings) =>
  invoke<State>('save_inspection', { scene, name, settings })

export const reorderItems = (scene: Scene, kind: 'providers' | 'homes', names: string[]) =>
  invoke<State>('reorder_items', { scene, kind, names })

export const getApiProbeProfiles = () => invoke<ApiProbeProfile[]>('get_api_probe_profiles')
export const getApiAccounts = () => invoke<ApiAccount[]>('get_api_accounts')
export const getApiAccountKey = (id: string) => invoke<string>('get_api_account_key', { id })
export const openExternalUrl = (url: string) => invoke<void>('open_external_url', { url })
export const saveApiAccount = (originalName: string | null, name: string, kind: 'subscription' | 'direct', endpoints: ApiEndpoint[], quota: ApiQuotaSettings, key: string, consoleUrl: string) =>
  invoke<ApiAccount[]>('save_api_account', { originalName, name, kind, endpoints, quota, key, consoleUrl })
export const deleteApiAccount = (name: string) => invoke<ApiAccount[]>('delete_api_account', { name })
export const reorderApiAccounts = (names: string[]) => invoke<ApiAccount[]>('reorder_api_accounts', { names })
export const probeApiAccount = (id: string) => invoke<ApiProbeResult>('probe_api_account', { id })
export const checkApiModel = (id: string, model: string, protocol: 'openai' | 'openai_responses' | 'anthropic' | 'genai' | 'vertexai') =>
  invoke<ProbeResult>('check_api_model', { id, model, protocol })
