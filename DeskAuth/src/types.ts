export type Purpose = 'login' | 'verify' | 'recovery' | 'contact'
export type ContactKind = 'phones' | 'emails'
export interface Contact { id: string; value: string; label: string; purposes: Purpose[]; primary: boolean; notes: string }
export interface Account {
  id: string; platform: string; website: string; alias: string; username: string; hasPassword: boolean
  phones: Contact[]; emails: Contact[]; group: string; tags: string[]; color: string; favorite: boolean; notes: string
  createdAt: number; updatedAt: number; passwordUpdatedAt: number | null
}
export interface AccountInput {
  id: string | null; platform: string; website: string; alias: string; username: string; password: string | null
  phones: Contact[]; emails: Contact[]; group: string; tags: string[]; color: string; notes: string
}
export interface AppState { dataDir: string | null; accounts: Account[]; startupError: string | null }
export type Notify = (message: string, error?: boolean) => void
export interface ContactLookup { kind: ContactKind; value: string }
export const purposes: { value: Purpose; label: string }[] = [
  { value: 'login', label: '登录' }, { value: 'verify', label: '验证' },
  { value: 'recovery', label: '找回' }, { value: 'contact', label: '联系' },
]
