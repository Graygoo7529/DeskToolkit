import { invoke } from '@tauri-apps/api/core'
import { writeText } from '@tauri-apps/plugin-clipboard-manager'
import type { AccountInput, AppState } from './types'

export const api = {
  state: () => invoke<AppState>('get_state'),
  suggest: () => invoke<string>('suggest_data_dir'),
  directory: (path: string) => invoke<AppState>('change_data_dir', { path }),
  openDirectory: () => invoke<void>('open_data_dir'),
  save: (input: AccountInput) => invoke<{ state: AppState; id: string }>('save_account', { input }),
  delete: (id: string) => invoke<AppState>('delete_account', { id }),
  favorite: (id: string, favorite: boolean) => invoke<AppState>('set_favorite', { id, favorite }),
  password: (id: string) => invoke<string>('reveal_password', { id }),
  copyPassword: (id: string) => invoke<void>('copy_password', { id }),
  openWebsite: (id: string) => invoke<void>('open_website', { id }),
  copy: (text: string) => writeText(text),
  import: (path: string) => invoke<{ state: AppState; added: number; skipped: number }>('import_backup', { path }),
  export: (path: string) => invoke<void>('export_backup', { path }),
}
