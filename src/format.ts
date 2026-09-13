import type { Customer, Transaction } from './types'

export const id = (prefix: string) =>
  `${prefix}-${crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`}`

export const money = (value: number) =>
  `₹${new Intl.NumberFormat('en-IN', {
    maximumFractionDigits: 2,
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
  }).format(Math.abs(value))}`

export const balance = (customer: Customer) =>
  customer.transactions.reduce((sum, tx) => sum + (tx.type === 'credit' ? tx.amount : -tx.amount), 0)

export const indianPhone = (value: string) => {
  const digits = value.replace(/\D/g, '')
  if (/^[6-9]\d{9}$/.test(digits)) return `+91 ${digits.slice(0, 5)} ${digits.slice(5)}`
  if (/^0[6-9]\d{9}$/.test(digits)) return `+91 ${digits.slice(1, 6)} ${digits.slice(6)}`
  if (/^91[6-9]\d{9}$/.test(digits)) return `+91 ${digits.slice(2, 7)} ${digits.slice(7)}`
  return ''
}

export const phoneDigits = (value: string) => {
  let digits = value.replace(/\D/g, '')
  if (digits.startsWith('0')) digits = digits.slice(1)
  if (digits.startsWith('91') && digits.length === 12) digits = digits.slice(2)
  return digits
}

export const waLink = (phone: string, text: string) => {
  const digits = phoneDigits(phone)
  const num = digits.length === 10 ? `91${digits}` : digits
  return `https://wa.me/${num}?text=${encodeURIComponent(text)}`
}

export const telLink = (phone: string) => {
  const digits = phoneDigits(phone)
  return `tel:+${digits.length === 10 ? '91' : ''}${digits}`
}

export const formatDate = (value: string) =>
  new Date(value).toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })

export const formatDay = (value: string) =>
  new Date(value).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })

export const initials = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .map(part => part[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()

export const tone = (name: string) => ['peach', 'lavender', 'mint', 'yellow', 'blue'][name.length % 5]

export const lastActivity = (customer: Customer) =>
  customer.transactions.reduce((max, tx) => (tx.date > max ? tx.date : max), customer.createdAt || '')

export const isOverdue = (customer: Customer) => {
  if (balance(customer) <= 0) return false
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return customer.transactions.some(tx => tx.type === 'credit' && tx.dueDate && new Date(tx.dueDate) < today)
}

export const oldestDue = (customer: Customer): Transaction | undefined => {
  if (balance(customer) <= 0) return undefined
  return customer.transactions
    .filter(tx => tx.type === 'credit' && tx.dueDate)
    .sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || ''))[0]
}

export function startOfToday() {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

export function dueBucket(customer: Customer): 'overdue' | 'due-today' | 'due-soon' | 'none' {
  if (balance(customer) <= 0) return 'none'
  const credits = customer.transactions.filter(tx => tx.type === 'credit' && tx.dueDate)
  if (!credits.length) return 'none'
  const today = startOfToday()
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  const soon = new Date(today)
  soon.setDate(soon.getDate() + 7)
  let hasSoon = false
  for (const tx of credits) {
    const due = (tx.dueDate || '').slice(0, 10)
    if (!due) continue
    if (due < todayStr) return 'overdue'
    if (due === todayStr) return 'due-today'
    if (due <= `${soon.getFullYear()}-${String(soon.getMonth() + 1).padStart(2, '0')}-${String(soon.getDate()).padStart(2, '0')}`) hasSoon = true
  }
  return hasSoon ? 'due-soon' : 'none'
}

export function dueAmount(customer: Customer): number {
  const todayStr = startOfToday().toISOString().slice(0, 10)
  return customer.transactions
    .filter(tx => tx.type === 'credit' && tx.dueDate && (tx.dueDate || '').slice(0, 10) <= todayStr)
    .reduce((sum, tx) => sum + tx.amount, 0)
}

export function upiPayLink(upiId: string, amount: number, note: string) {
  const params = new URLSearchParams({
    pa: upiId.trim(),
    pn: note.slice(0, 40) || 'Khata',
    am: String(Math.max(Math.round(amount * 100) / 100, 0.01)),
    cu: 'INR',
    tn: note.slice(0, 80),
  })
  return `upi://pay?${params.toString()}`
}

export function monthKeyOf(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

export function lastMonths(count: number) {
  const out: { key: string; label: string }[] = []
  const now = new Date()
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    out.push({ key: monthKeyOf(d), label: d.toLocaleDateString('en-IN', { month: 'short' }) })
  }
  return out
}

export async function hashPin(pin: string) {
  const buffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`khata-pin-v1:${pin}`))
  return [...new Uint8Array(buffer)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

export function reminderText(business: string, customer: Customer) {
  const value = balance(customer)
  const due = oldestDue(customer)
  const dueBit = due?.dueDate ? ` Due date: ${formatDay(due.dueDate)}.` : ''
  if (value > 0)
    return `Namaste ${customer.name}, this is a reminder from ${business}. Your outstanding balance is ${money(value)}.${dueBit} Please settle at your convenience.`
  if (value < 0)
    return `Namaste ${customer.name}, ${business} still owes you ${money(value)}. We will settle this shortly.`
  return `Namaste ${customer.name}, your account with ${business} is fully settled. Thank you.`
}

export function statementText(business: string, customer: Customer) {
  const value = balance(customer)
  const lines = [
    `${business} · Khata statement`,
    `${customer.name} · ${customer.phone}`,
    `Balance: ${value === 0 ? 'Settled' : `${value < 0 ? '-' : ''}${money(value)}`}`,
    '',
    ...[...customer.transactions]
      .sort((a, b) => a.date.localeCompare(b.date))
      .map(
        tx =>
          `${formatDay(tx.date)}  ${tx.type === 'credit' ? 'You gave' : 'You got'}  ${money(tx.amount)}${tx.note ? `  (${tx.note})` : ''}`,
      ),
  ]
  return lines.join('\n')
}
