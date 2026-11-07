import type { Account, ContactKind } from './types'

const norm = (value: string) => value.normalize('NFKC').toLocaleLowerCase().trim()
export const contactKey = (value: string, kind: ContactKind) => kind === 'phones' ? value.replace(/[^0-9]/g, '') : value.trim().toLowerCase()
export const sortAccounts = (a: Account, b: Account) => Number(b.favorite) - Number(a.favorite)
  || a.platform.localeCompare(b.platform, 'zh-CN') || a.username.localeCompare(b.username, 'zh-CN') || a.alias.localeCompare(b.alias, 'zh-CN')

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
