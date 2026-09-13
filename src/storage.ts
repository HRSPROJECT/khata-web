import type { Customer, LedgerData, Settings, Transaction } from './types'

const KEY = 'khata-react-data-v1'
const UNLOCK = 'khata-unlocked'

export const defaultSettings: Settings = {
  theme: 'system',
  businessName: 'My shop',
  upiId: '',
  lockEnabled: false,
  pinHash: '',
}

const empty: LedgerData = { version: 2, customers: [], settings: defaultSettings }

function migrateCustomer(raw: Customer): Customer {
  return {
    id: raw.id,
    name: raw.name,
    phone: raw.phone,
    address: raw.address || '',
    note: raw.note || '',
    createdAt: raw.createdAt || new Date().toISOString(),
    creditLimit: typeof raw.creditLimit === 'number' && raw.creditLimit > 0 ? raw.creditLimit : undefined,
    transactions: (raw.transactions || []).map(
      (tx: Transaction): Transaction => ({
        id: tx.id,
        type: tx.type,
        amount: tx.amount,
        date: tx.date,
        note: tx.note || '',
        photo: tx.photo,
        dueDate: tx.dueDate || '',
      }),
    ),
  }
}

export function loadLedger(): LedgerData {
  try {
    const value = localStorage.getItem(KEY)
    if (!value) return empty
    const parsed = JSON.parse(value) as Partial<LedgerData>
    if (!parsed || !Array.isArray(parsed.customers)) return empty
    return {
      version: 2,
      customers: parsed.customers.map(migrateCustomer),
      settings: { ...defaultSettings, ...(parsed.settings || {}) },
    }
  } catch {
    return empty
  }
}

export function saveLedger(data: LedgerData): boolean {
  try {
    const payload = JSON.stringify(data)
    localStorage.setItem(KEY, payload)
    return localStorage.getItem(KEY) === payload
  } catch {
    return false
  }
}

export function downloadBackup(data: LedgerData) {
  const blob = new Blob([JSON.stringify({ ...data, exportedAt: new Date().toISOString() }, null, 2)], {
    type: 'application/json',
  })
  triggerDownload(blob, `khata-backup-${new Date().toISOString().slice(0, 10)}.json`)
}

export function downloadCsv(data: LedgerData) {
  const rows = [['Customer', 'Phone', 'Type', 'Amount', 'Date', 'Note', 'Due date', 'Running idea']]
  for (const customer of data.customers) {
    if (!customer.transactions.length) {
      rows.push([customer.name, customer.phone, '', '0', '', '', '', '0'])
      continue
    }
    let running = 0
    for (const tx of [...customer.transactions].sort((a, b) => a.date.localeCompare(b.date))) {
      running += tx.type === 'credit' ? tx.amount : -tx.amount
      rows.push([
        customer.name,
        customer.phone,
        tx.type === 'credit' ? 'You gave' : 'You got',
        String(tx.amount),
        tx.date,
        tx.note,
        tx.dueDate || '',
        String(running),
      ])
    }
  }
  const csv = rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n')
  triggerDownload(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `khata-ledger-${new Date().toISOString().slice(0, 10)}.csv`)
}

function triggerDownload(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  URL.revokeObjectURL(url)
}

export function downloadCustomerCsv(customer: Customer) {
  const rows = [['Date', 'Type', 'Amount', 'Note', 'Due date']]
  for (const tx of [...customer.transactions].sort((a, b) => a.date.localeCompare(b.date))) {
    rows.push([
      tx.date,
      tx.type === 'credit' ? 'You gave' : 'You got',
      String(tx.amount),
      tx.note,
      tx.dueDate || '',
    ])
  }
  const csv = rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n')
  triggerDownload(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `khata-${customer.name.replace(/\s+/g, '-').toLowerCase()}.csv`)
}
export function storageUsageBytes(): number {
  try {
    let total = 0
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (!key) continue
      total += (localStorage.getItem(key) || '').length * 2
    }
    return total
  } catch {
    return 0
  }
}

const SYNC_BACKUP_KEY = 'khata-react-data-sync-backup'

// Safety snapshot taken automatically before incoming sync data is applied.
export function saveSyncBackup(data: LedgerData): boolean {
  try {
    localStorage.setItem(SYNC_BACKUP_KEY, JSON.stringify({ ...data, savedAt: new Date().toISOString() }))
    return true
  } catch {
    return false
  }
}

export function isSessionUnlocked() {
  return sessionStorage.getItem(UNLOCK) === '1'
}

export function setSessionUnlocked(value: boolean) {
  if (value) sessionStorage.setItem(UNLOCK, '1')
  else sessionStorage.removeItem(UNLOCK)
}

export function applyTheme(theme: Settings['theme']) {
  const dark =
    theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.dataset.theme = dark ? 'dark' : 'light'
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#12151c' : '#5b65d8')
}

