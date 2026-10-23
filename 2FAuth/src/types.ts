export type Algorithm = 'SHA1' | 'SHA256' | 'SHA512'
export interface Account {
  id: string; issuer: string; account: string; algorithm: Algorithm; digits: number; period: number
  group: string; color: string; favorite: boolean; notes: string; recoveryTotal: number; recoveryRemaining: number
}
export interface AppState { dataDir: string | null; accounts: Account[]; startupError: string | null }
export interface AccountInput {
  id: string | null; issuer: string; account: string; secret: string | null; algorithm: Algorithm
  digits: number; period: number; group: string; color: string; notes: string
}
export interface RecoveryCode { id: string; code: string; used: boolean }
export interface OtpCode { code: string; period: number; validUntil: number; generatedAt: number }
export type Notify = (message: string, error?: boolean) => void
