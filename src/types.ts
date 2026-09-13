export type TransactionType = 'credit' | 'payment'

export type Transaction = {
  id: string
  type: TransactionType
  amount: number
  date: string
  note: string
  photo?: string
  dueDate?: string
}

export type Customer = {
  id: string
  name: string
  phone: string
  address?: string
  note?: string
  createdAt: string
  creditLimit?: number
  transactions: Transaction[]
}

export type Theme = 'light' | 'dark' | 'system'

export type Settings = {
  theme: Theme
  businessName: string
  upiId: string
  lockEnabled: boolean
  pinHash: string
}

export type LedgerData = {
  version: 2
  customers: Customer[]
  settings: Settings
}

export type ContactFilter = 'all' | 'take' | 'give' | 'settled' | 'overdue'
export type ContactSort = 'recent' | 'name' | 'take' | 'give'
