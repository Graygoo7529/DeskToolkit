import { invoke } from '@tauri-apps/api/core'
import type { State, Scene, ProbeTask, ProbeResult, InspectionInput, ApiAccount, ApiProbeResult, ApiEndpoint, QuotaInput, ApiProbeProfile } from './types'

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
export type DataDirStatus = 'empty' | 'valid' | 'legacy' | 'invalid' | 'current'
export interface DataDirReport { status: DataDirStatus; message: string; path: string; entries: string[]; backup_path: string | null }
export const inspectDataDir = (path: string) => invoke<DataDirReport>('inspect_data_dir', { path })
export const changeDataDir = (path: string, confirmBackup = false) => invoke<State>('change_data_dir', { path, confirmBackup })

export const inspectProvider = (scene: Scene, name: string, task: ProbeTask) =>
  invoke<ProbeResult>('inspect_provider', { scene, name, task })

export const saveInspection = (scene: Scene, name: string, settings: InspectionInput) =>
  invoke<State>('save_inspection', { scene, name, settings })

export const reorderItems = (scene: Scene, kind: 'providers' | 'homes', names: string[]) =>
  invoke<State>('reorder_items', { scene, kind, names })

export const getApiProbeProfiles = () => invoke<ApiProbeProfile[]>('get_api_probe_profiles')
export interface QuotaProfileWindow { id: string; label: string; required: boolean; used_pointer: string; limit_pointer: string; remaining_pointer: string; reset_pointer: string; limit_value?: number | null }
export interface QuotaProfileBlock { component: 'balance_card' | 'quota_card'; source: string; title: string }
export interface QuotaProfileDraft { id?: string; label: string; kind: 'balance' | 'subscription'; layout_label: string; request_method: 'GET' | 'POST'; request_path: string; request_auth_mode: 'auto' | 'none'; request_body?: string; balance_pointer?: string; fallback_balance_pointer?: string; unit_pointer?: string; default_unit?: string; membership_pointer?: string; blocks: QuotaProfileBlock[]; windows: QuotaProfileWindow[] }
export const createQuotaProfile = (input: QuotaProfileDraft) => invoke<ApiProbeProfile>('create_quota_profile', { input })
export const getApiAccounts = () => invoke<ApiAccount[]>('get_api_accounts')
export const getApiAccountKey = (id: string) => invoke<string>('get_api_account_key', { id })
export const openExternalUrl = (url: string) => invoke<void>('open_external_url', { url })
export const saveApiAccount = (originalName: string | null, name: string, kind: 'subscription' | 'direct', endpoints: ApiEndpoint[], quota: QuotaInput, key: string, consoleUrl: string) =>
  invoke<ApiAccount[]>('save_api_account', { originalName, name, kind, endpoints, quota, key, consoleUrl })
export const deleteApiAccount = (name: string) => invoke<ApiAccount[]>('delete_api_account', { name })
export const reorderApiAccounts = (names: string[]) => invoke<ApiAccount[]>('reorder_api_accounts', { names })
export const probeApiAccount = (id: string) => invoke<ApiProbeResult>('probe_api_account', { id })
export const checkApiModel = (id: string, model: string, protocol: 'openai' | 'openai_responses' | 'anthropic' | 'genai') =>
  invoke<ProbeResult>('check_api_model', { id, model, protocol })
