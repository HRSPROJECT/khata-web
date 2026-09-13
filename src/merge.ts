import type { Customer, LedgerData } from './types'

// Smart-merge: union by id, so entries created on either device survive.
// Sender's contact details win for matching contacts. Settings never sync.

export type MergePreview = {
  incomingCustomers: number
  incomingTransactions: number
  addedCustomers: number
  addedTransactions: number
  updatedCustomers: number
}

// --- merge (union by id; sender's contact details win) ------------------------

export function previewMerge(local: LedgerData, incoming: Customer[]): MergePreview {
  const byId = new Map(local.customers.map(c => [c.id, c]))
  let addedCustomers = 0
  let addedTransactions = 0
  let updatedCustomers = 0
  for (const inc of incoming) {
    const mine = byId.get(inc.id)
    if (!mine) {
      addedCustomers++
      continue
    }
    const mineTx = new Set(mine.transactions.map(t => t.id))
    const fresh = inc.transactions.filter(t => !mineTx.has(t.id)).length
    addedTransactions += fresh
    const scalarsDiffer =
      mine.name !== inc.name || mine.phone !== inc.phone || (mine.address || '') !== (inc.address || '') || (mine.note || '') !== (inc.note || '') || (mine.creditLimit ?? 0) !== (inc.creditLimit ?? 0)
    if (fresh > 0 || scalarsDiffer) updatedCustomers++
  }
  return {
    incomingCustomers: incoming.length,
    incomingTransactions: incoming.reduce((n, c) => n + c.transactions.length, 0),
    addedCustomers,
    addedTransactions,
    updatedCustomers,
  }
}

export function mergeLedgers(local: LedgerData, incoming: Customer[]): LedgerData {
  const byId = new Map(local.customers.map(c => [c.id, { ...c, transactions: [...c.transactions] }]))
  for (const inc of incoming) {
    const mine = byId.get(inc.id)
    if (!mine) {
      byId.set(inc.id, { ...inc, transactions: [...inc.transactions] })
      continue
    }
    const seen = new Set(mine.transactions.map(t => t.id))
    for (const tx of inc.transactions) if (!seen.has(tx.id)) mine.transactions.push({ ...tx })
    mine.name = inc.name
    mine.phone = inc.phone
    mine.address = inc.address || ''
    mine.note = inc.note || ''
    if (inc.creditLimit !== undefined) mine.creditLimit = inc.creditLimit
  }
  return { ...local, customers: [...byId.values()] }
}

