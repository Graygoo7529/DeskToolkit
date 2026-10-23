import { invoke } from '@tauri-apps/api/core'
import { writeText } from '@tauri-apps/plugin-clipboard-manager'
import type { AccountInput, AppState, OtpCode, RecoveryCode, TimeStatus } from './types'

export const api = {
  state: () => invoke<AppState>('get_state'),
  suggest: () => invoke<string>('suggest_data_dir'),
  directory: (path: string) => invoke<AppState>('change_data_dir', { path }),
  openDirectory: () => invoke<void>('open_data_dir'),
  parse: (uri: string) => invoke<Pick<AccountInput, 'issuer' | 'account' | 'secret' | 'algorithm' | 'digits' | 'period'>>('parse_uri', { uri }),
  save: (input: AccountInput) => invoke<{ state: AppState; id: string }>('save_account', { input }),
  delete: (id: string) => invoke<AppState>('delete_account', { id }),
  favorite: (id: string, favorite: boolean) => invoke<AppState>('set_favorite', { id, favorite }),
  code: (id: string) => invoke<OtpCode>('get_code', { id }),
  timeStatus: () => invoke<TimeStatus>('get_time_status'),
  onlineTime: (enabled: boolean) => invoke<TimeStatus>('set_online_time', { enabled }),
  syncTime: () => invoke<TimeStatus>('sync_time'),
  secret: (id: string) => invoke<string>('reveal_secret', { id }),
  recovery: (id: string) => invoke<RecoveryCode[]>('get_recovery_codes', { id }),
  saveRecovery: (id: string, text: string) => invoke<AppState>('save_recovery_codes', { id, text }),
  used: (id: string, codeId: string, used: boolean) => invoke<AppState>('set_recovery_used', { id, codeId, used }),
  import: (path: string) => invoke<{ state: AppState; added: number; skipped: number }>('import_backup', { path }),
  export: (path: string) => invoke<void>('export_backup', { path }),
  copy: writeText,
}
