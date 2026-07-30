export interface Home {
  name: string
  location: string
}

export interface Provider {
  name: string
  url: string
  key_masked: string
}

export interface HomeStatus {
  config_exists: boolean
  auth_exists: boolean
  base_url: string | null
  api_key_masked: string | null
  matched_provider: string | null
}

export interface State {
  homes: Home[]
  providers: Provider[]
  data_dir: string
  statuses: Record<string, HomeStatus>
}
