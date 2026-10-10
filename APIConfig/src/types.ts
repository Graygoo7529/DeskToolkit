export interface Home {
  name: string
  location: string
}

export interface Provider {
  name: string
  color: string
  url: string
  key_masked: string
  inspection: InspectionSettings
}

export interface HomeStatus {
  config_exists: boolean
  auth_exists: boolean
  base_url: string | null
  api_key_masked: string | null
  matched_provider: string | null
}

export interface ClaudeHome {
  name: string
  location: string
}

export type ClaudeProvider = Provider

export interface ClaudeStatus {
  settings_exists: boolean
  base_url: string | null
  auth_token_masked: string | null
  matched_provider: string | null
}

export interface State {
  homes: Home[]
  providers: Provider[]
  data_dir: string
  statuses: Record<string, HomeStatus>
  claude_homes: ClaudeHome[]
  claude_providers: ClaudeProvider[]
  claude_statuses: Record<string, ClaudeStatus>
}

export type Scene = 'codex' | 'claude'
export type ProbeTask = 'connection' | 'models' | 'quota'
export type Auth = 'bearer' | 'x_api_key' | 'none'
export interface InspectionSettings {
  models_path: string
  models_auth: Auth
  quota: {
    adapter: 'none' | 'kimi' | 'custom'
    path: string
    auth: Auth
    balance_pointer: string
    used_pointer: string
    limit_pointer: string
    remaining_pointer: string
    reset_pointer: string
    unit: string
  }
}
export interface ProbeResult {
  status: 'ok' | 'partial' | 'error' | 'skipped'
  message: string
  checked_at: number
  latency_ms: number
  http_status: number | null
  models: { id: string; name: string | null }[]
  quota: {
    balance: number | null
    unit: string
    membership: string | null
    windows: { id?: string; name: string; used: number | null; limit: number | null; remaining: number | null; reset_at: string | null }[]
  } | null
}
export interface ProbeSlot {
  pending?: 'queued' | 'running'
  result?: ProbeResult
  lastGood?: ProbeResult
}
export type ProviderResults = Partial<Record<ProbeTask, ProbeSlot>>

export interface ApiAccount {
  id: string
  kind: 'subscription' | 'direct'
  name: string
  url: string
  key_masked: string
  color: string
  configured: boolean
  endpoints: ApiEndpoint[]
  quota_adapter: string
  quota: ApiQuotaSettings
  console_url: string
}

export type ApiProtocol = 'openai' | 'openai_responses' | 'anthropic' | 'genai' | 'vertexai'
export interface ApiEndpoint { protocol: ApiProtocol; url: string; auth: Auth }
export interface ApiQuotaSettings { profile: string; presentation?: 'balance' | 'quota'; adapter?: string; path: string; auth: Auth; balance_pointer: string; used_pointer: string; limit_pointer: string; remaining_pointer: string; reset_pointer: string; unit: string }
export interface ApiProbeProfile { id: string; label: string; description: string; kind: string; layout_id: string; layout_label: string; blocks: { component: string; source: string; title: string }[] }

export interface ApiProbeResult {
  model_sets: { protocol: ApiProtocol; result: ProbeResult }[]
  quota: ProbeResult | null
}
