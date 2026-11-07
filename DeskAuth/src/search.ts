import type { Account, ContactKind } from './types'

const norm = (value: string) => value.normalize('NFKC').toLocaleLowerCase().trim()
export const contactKey = (value: string, kind: ContactKind) => kind === 'phones' ? value.replace(/[^0-9]/g, '') : value.trim().toLowerCase()
export const sortAccounts = (a: Account, b: Account) => Number(b.favorite) - Number(a.favorite)
  || a.platform.localeCompare(b.platform, 'zh-CN') || a.username.localeCompare(b.username, 'zh-CN') || a.alias.localeCompare(b.alias, 'zh-CN')

export const accountSorts = [
  { value: 'name-asc', label: '名称 A → Z' },
  { value: 'name-desc', label: '名称 Z → A' },
  { value: 'username', label: '用户名 A → Z' },
  { value: 'updated', label: '最近更新' },
  { value: 'created', label: '最近添加' },
  { value: 'favorites', label: '收藏优先' },
] as const
export type AccountSort = typeof accountSorts[number]['value']

export function compareAccounts(a: Account, b: Account, order: AccountSort) {
  const name = a.platform.localeCompare(b.platform, 'zh-CN', { numeric: true, sensitivity: 'base' })
  const username = a.username.localeCompare(b.username, 'zh-CN', { numeric: true, sensitivity: 'base' })
  const fallback = name || username || a.alias.localeCompare(b.alias, 'zh-CN') || a.id.localeCompare(b.id)
  switch (order) {
    case 'name-desc': return -name || username || fallback
    case 'username': return username || fallback
    case 'updated': return b.updatedAt - a.updatedAt || fallback
    case 'created': return b.createdAt - a.createdAt || fallback
    case 'favorites': return Number(b.favorite) - Number(a.favorite) || fallback
    default: return fallback
  }
}

export function matchesAccount(a: Account, query: string, platform: string) {
  if (!norm(`${a.platform} ${a.website}`).includes(norm(platform))) return false
  const text = norm([a.platform, a.website, a.alias, a.username, a.group, ...a.tags, a.notes,
    ...[...a.phones, ...a.emails].flatMap(c => [c.value, c.label, c.notes])].join(' '))
  return norm(query).split(/\s+/).filter(Boolean).every(term => text.includes(term)
    || (/^[+()0-9.-]+$/.test(term) && a.phones.some(c => contactKey(c.value, 'phones').includes(contactKey(term, 'phones')))
      && contactKey(term, 'phones').length > 0))
}
export interface ContactGroup { key: string; value: string; labels: string[]; accounts: Account[] }
export function contactIndex(accounts: Account[], kind: ContactKind): ContactGroup[] {
  const groups = new Map<string, ContactGroup>()
  for (const account of accounts) for (const contact of account[kind]) {
    const key = contactKey(contact.value, kind)
    const group = groups.get(key) ?? { key, value: contact.value, labels: [], accounts: [] }
    if (!group.accounts.some(a => a.id === account.id)) group.accounts.push(account)
    if (contact.label && !group.labels.includes(contact.label)) group.labels.push(contact.label)
    groups.set(key, group)
  }
  return [...groups.values()].map(g => ({ ...g, accounts: g.accounts.sort(sortAccounts) }))
    .sort((a, b) => b.accounts.length - a.accounts.length || a.value.localeCompare(b.value))
}
export function matchesContact(group: ContactGroup, query: string, kind: ContactKind) {
  const term = norm(query)
  return !term || norm([group.value, ...group.labels].join(' ')).includes(term)
    || (kind === 'phones' && /^[+()0-9.\s-]+$/.test(term) && contactKey(term, kind).length > 0 && group.key.includes(contactKey(term, kind)))
}
