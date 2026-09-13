import { ChangeEvent, FormEvent, Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react'
import type { ContactFilter, ContactSort, Customer, LedgerData, Settings, Transaction, TransactionType } from './types'
import {
  applyTheme,
  downloadBackup,
  downloadCsv,
  downloadCustomerCsv,
  isSessionUnlocked,
  loadLedger,
  saveLedger,
  saveSyncBackup,
  setSessionUnlocked,
  storageUsageBytes,
} from './storage'
import {
  balance,
  dueAmount,
  dueBucket,
  formatDate,
  formatDay,
  hashPin,
  id,
  indianPhone,
  initials,
  isOverdue,
  lastActivity,
  lastMonths,
  money,
  reminderText,
  statementText,
  telLink,
  tone,
  upiPayLink,
  waLink,
} from './format'
import { usePwaInstall } from './pwa'
import { mergeLedgers } from './merge'

type View = 'home' | 'reports' | 'settings' | 'customer' | 'sync'
type Modal = 'customer' | 'transaction' | 'pin' | 'ios-install' | 'edit-tx' | null

function parseHash(): { view: View; id: string | null; newbie: boolean; shared: string } {
  const raw = window.location.hash.replace(/^#/, '') || '/'
  const [path, query] = raw.split('?')
  const params = new URLSearchParams(query || '')
  const newbie = params.get('new') === '1' || params.get('action') === 'add'
  const shared = params.get('text') || params.get('url') || params.get('title') || ''
  if (path.startsWith('/c/')) return { view: 'customer', id: decodeURIComponent(path.slice(3)), newbie: false, shared: '' }
  if (path.startsWith('/reports')) return { view: 'reports', id: null, newbie: false, shared: '' }
  if (path.startsWith('/settings')) return { view: 'settings', id: null, newbie: false, shared: '' }
  if (path.startsWith('/sync')) return { view: 'sync', id: null, newbie: false, shared: '' }
  return { view: 'home', id: null, newbie, shared }
}

function go(path: string) {
  if (window.location.hash === `#${path}`) window.dispatchEvent(new HashChangeEvent('hashchange'))
  else window.location.hash = path
}

function App() {
  const [data, setData] = useState<LedgerData>(loadLedger)
  const [route, setRoute] = useState(parseHash)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<ContactFilter>('all')
  const [sort, setSort] = useState<ContactSort>('recent')
  const [modal, setModal] = useState<Modal>(null)
  const [transactionType, setTransactionType] = useState<TransactionType>('credit')
  const [editingTx, setEditingTx] = useState<Transaction | null>(null)
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null)
  const [toast, setToast] = useState('')
  const [unlocked, setUnlocked] = useState(() => !loadLedger().settings.lockEnabled || isSessionUnlocked())
  const importRef = useRef<HTMLInputElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const pwa = usePwaInstall()
  const selected = data.customers.find(customer => customer.id === route.id) ?? null

  useEffect(() => {
    applyTheme(data.settings.theme)
    const onScheme = () => applyTheme(data.settings.theme)
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', onScheme)
    return () => window.matchMedia('(prefers-color-scheme: dark)').removeEventListener('change', onScheme)
  }, [data.settings.theme])

  useEffect(() => {
    const onHash = () => {
      const next = parseHash()
      setRoute(next)
      if (next.newbie) {
        setEditingCustomer(null)
        setModal('customer')
      }
      if (next.shared) setQuery(next.shared.slice(0, 80))
    }
    if (!window.location.hash) window.location.hash = '/'
    onHash()
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === '/' && (event.target as HTMLElement).tagName !== 'INPUT' && (event.target as HTMLElement).tagName !== 'TEXTAREA') {
        event.preventDefault()
        go('/')
        searchRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const persist = (next: LedgerData, message?: string) => {
    setData(next)
    applyTheme(next.settings.theme)
    if (!saveLedger(next)) {
      setToast('Browser storage is unavailable. Export a backup now.')
      return
    }
    if (message) {
      setToast(message)
      window.setTimeout(() => setToast(''), 2600)
    }
  }

  const updateCustomer = (customer: Customer, message?: string) =>
    persist({ ...data, customers: data.customers.map(item => (item.id === customer.id ? customer : item)) }, message)

  const updateSettings = (settings: Settings, message?: string) => persist({ ...data, settings }, message)

  const flash = (message: string) => {
    setToast(message)
    window.setTimeout(() => setToast(''), 2600)
  }

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const list = data.customers.filter(customer => {
      const hay = `${customer.name} ${customer.phone} ${customer.address || ''} ${customer.note || ''} ${customer.transactions.map(tx => tx.note).join(' ')}`.toLowerCase()
      if (needle && !hay.includes(needle)) return false
      const value = balance(customer)
      if (filter === 'take') return value > 0
      if (filter === 'give') return value < 0
      if (filter === 'settled') return value === 0
      if (filter === 'overdue') return isOverdue(customer)
      return true
    })
    const copy = [...list]
    copy.sort((a, b) => {
      if (sort === 'name') return a.name.localeCompare(b.name)
      if (sort === 'take') return balance(b) - balance(a)
      if (sort === 'give') return balance(a) - balance(b)
      return lastActivity(b).localeCompare(lastActivity(a))
    })
    return copy
  }, [data.customers, query, filter, sort])

  const totals = useMemo(
    () =>
      data.customers.reduce(
        (all, customer) => {
          const value = balance(customer)
          return {
            take: all.take + Math.max(value, 0),
            give: all.give + Math.max(-value, 0),
            overdue: all.overdue + (isOverdue(customer) ? 1 : 0),
          }
        },
        { take: 0, give: 0, overdue: 0 },
      ),
    [data],
  )

  const importData = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result)) as LedgerData
        if (!Array.isArray(parsed.customers)) throw Error()
        if (confirm(`Replace this workspace with ${parsed.customers.length} contacts?`))
          persist(
            {
              version: 2,
              customers: parsed.customers,
              settings: { ...data.settings, ...(parsed.settings || {}) },
            },
            'Backup restored',
          )
      } catch {
        flash('That backup file is invalid.')
      }
    }
    reader.readAsText(file)
    event.target.value = ''
  }

  if (!unlocked) {
    return (
      <LockScreen
        settings={data.settings}
        onUnlock={() => {
          setSessionUnlocked(true)
          setUnlocked(true)
        }}
      />
    )
  }

  const view = route.view === 'customer' && !selected ? 'home' : route.view

  return (
    <div className={`app-shell ${pwa.installed ? 'installed' : ''}`}>
      {!pwa.online && <div className="offline-bar">Offline · your ledger still works on this device</div>}
      {pwa.updateAvailable && (
        <div className="update-bar">
          <span>A new version of Khata is ready.</span>
          <button onClick={pwa.applyUpdate}>Update now</button>
        </div>
      )}
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">K</div>
          <div>
            <strong>Khata</strong>
            <small>{data.settings.businessName}</small>
          </div>
        </div>
        <div className="top-actions">
          <button className="outline small-only-text" onClick={() => go('/sync')}>
            ⇄ <span>Sync</span>
          </button>          {pwa.canInstall && (
            <button className="primary small-only-text" onClick={() => void pwa.install()}>
              ⊕ <span>Install app</span>
            </button>
          )}
          {pwa.ios && (
            <button className="outline small-only-text" onClick={() => setModal('ios-install')}>
              ⊕ <span>Add to Home</span>
            </button>
          )}
          <button className="outline small-only-text" onClick={() => downloadBackup(data)}>
            ↓ <span>Export</span>
          </button>
          <button className="outline small-only-text" onClick={() => importRef.current?.click()}>
            ↑ <span>Import</span>
          </button>
          <input ref={importRef} hidden type="file" accept="application/json" onChange={importData} />
        </div>
      </header>
      <main className="container">
        {view === 'home' && (
          <Dashboard
            customers={filtered}
            all={data.customers}
            totalCount={data.customers.length}
            totals={totals}
            query={query}
            setQuery={setQuery}
            filter={filter}
            setFilter={setFilter}
            sort={sort}
            setSort={setSort}
            searchRef={searchRef}
            canInstall={pwa.canInstall}
            onInstall={() => void pwa.install()}
            onSelect={id => go(`/c/${id}`)}
            onAdd={() => {
              setEditingCustomer(null)
              setModal('customer')
            }}
          />
        )}
        {view === 'customer' && selected && (
          <Ledger
            customer={selected}
            business={data.settings.businessName}
            upiId={data.settings.upiId}
            onBack={() => go('/')}
            onTransaction={type => {
              setTransactionType(type)
              setEditingTx(null)
              setModal('transaction')
            }}
            onEditCustomer={() => {
              setEditingCustomer(selected)
              setModal('customer')
            }}
            onEditTransaction={tx => {
              setEditingTx(tx)
              setTransactionType(tx.type)
              setModal('edit-tx')
            }}
            onDeleteCustomer={() => {
              if (confirm(`Delete ${selected.name} and all of their records? This cannot be undone.`)) {
                persist({ ...data, customers: data.customers.filter(customer => customer.id !== selected.id) }, 'Customer deleted')
                go('/')
              }
            }}
            onDeleteTransaction={transactionId => {
              if (confirm('Delete this record? This cannot be undone.'))
                updateCustomer({ ...selected, transactions: selected.transactions.filter(tx => tx.id !== transactionId) }, 'Record deleted')
            }}
          />
        )}
        {view === 'reports' && <Reports customers={data.customers} totals={totals} business={data.settings.businessName} onSelect={id => go(`/c/${id}`)} />}
        {view === 'sync' && (
          <Suspense
            fallback={
              <div className="empty compact">
                <h3>Loading sync…</h3>
              </div>
            }
          >
            <SyncPage
              data={data}
              onMerge={customers => {
                saveSyncBackup(data)
                const merged = mergeLedgers(data, customers)
                const now = new Date().toISOString()
                persist(
                  { ...merged, settings: { ...merged.settings, lastSyncAt: now } },
                  'Sync merged into this device',
                )
              }}
              onReplace={customers => {
                saveSyncBackup(data)
                persist(
                  { version: 2, customers, settings: { ...data.settings, lastSyncAt: new Date().toISOString() } },
                  'Sync applied to this device',
                )
              }}
              onTouchSync={() => updateSettings({ ...data.settings, lastSyncAt: new Date().toISOString() })}
            />
          </Suspense>
        )}
        {view === 'settings' && (
          <SettingsPage
            data={data}
            pwa={pwa}
            onSettings={updateSettings}
            onExport={() => downloadBackup(data)}
            onCsv={() => downloadCsv(data)}
            onImport={() => importRef.current?.click()}
            onClear={() => {
              if (confirm('Erase every contact and transaction on this device?')) {
                persist({ version: 2, customers: [], settings: data.settings }, 'Workspace cleared')
                go('/')
              }
            }}
            onLockNow={() => {
              setSessionUnlocked(false)
              setUnlocked(false)
            }}
            onIos={() => setModal('ios-install')}
          />
        )}
      </main>
      <nav className="bottom-nav">
        <button className={view === 'home' || view === 'customer' ? 'active' : ''} onClick={() => go('/')}>
          ⌂<span>Home</span>
        </button>
        <button className={view === 'reports' ? 'active' : ''} onClick={() => go('/reports')}>
          ▦<span>Reports</span>
        </button>
        <button
          onClick={() => {
            setEditingCustomer(null)
            setModal('customer')
          }}
        >
          ＋<span>Add</span>
        </button>
        <button className={view === 'sync' ? 'active' : ''} onClick={() => go('/sync')}>
          ⇄<span>Sync</span>
        </button>
        <button className={view === 'settings' ? 'active' : ''} onClick={() => go('/settings')}>
          ⚙<span>Settings</span>
        </button>
      </nav>
      {modal === 'customer' && (
        <CustomerModal
          existing={data.customers}
          initial={editingCustomer}
          onClose={() => {
            setModal(null)
            setEditingCustomer(null)
          }}
          onSave={customer => {
            if (editingCustomer) {
              updateCustomer(customer, 'Customer updated')
            } else {
              persist({ ...data, customers: [customer, ...data.customers] }, 'Customer added')
              go(`/c/${customer.id}`)
            }
            setModal(null)
            setEditingCustomer(null)
          }}
        />
      )}
      {(modal === 'transaction' || modal === 'edit-tx') && selected && (
        <TransactionModal
          type={transactionType}
          initial={modal === 'edit-tx' ? editingTx : null}
          onClose={() => {
            setModal(null)
            setEditingTx(null)
          }}
          onSave={transaction => {
            if (editingTx) {
              updateCustomer(
                { ...selected, transactions: selected.transactions.map(tx => (tx.id === transaction.id ? transaction : tx)) },
                'Record updated',
              )
            } else {
              updateCustomer({ ...selected, transactions: [...selected.transactions, transaction] })
              flash(transaction.type === 'credit' ? 'Credit recorded' : 'Payment recorded')
            }
            setModal(null)
            setEditingTx(null)
          }}
        />
      )}
      {modal === 'ios-install' && <IosInstallModal onClose={() => setModal(null)} />}
      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}

function Dashboard({
  customers,
  all,
  totalCount,
  totals,
  query,
  setQuery,
  filter,
  setFilter,
  sort,
  setSort,
  searchRef,
  canInstall,
  onInstall,
  onSelect,
  onAdd,
}: {
  customers: Customer[]
  all: Customer[]
  totalCount: number
  totals: { take: number; give: number; overdue: number }
  query: string
  setQuery: (value: string) => void
  filter: ContactFilter
  setFilter: (value: ContactFilter) => void
  sort: ContactSort
  setSort: (value: ContactSort) => void
  searchRef: { current: HTMLInputElement | null }
  canInstall: boolean
  onInstall: () => void
  onSelect: (id: string) => void
  onAdd: () => void
}) {
  const dueToday = all.filter(c => dueBucket(c) === 'due-today')
  const dueSoon = all.filter(c => dueBucket(c) === 'due-soon')
  const overdueAmt = all.reduce((sum, c) => sum + (isOverdue(c) ? balance(c) : 0), 0)
  return (
    <section>
      {(dueToday.length > 0 || overdueAmt > 0) && (
        <div className="dues-strip" role="status">
          <div>
            <strong>
              {dueToday.length > 0 ? `${dueToday.length} due today` : `${totals.overdue} overdue`}
            </strong>
            <small>
              {overdueAmt > 0 ? `${money(overdueAmt)} overdue` : ''}
              {overdueAmt > 0 && dueSoon.length > 0 ? ' · ' : ''}
              {dueSoon.length > 0 ? `${dueSoon.length} due this week` : ''}
            </small>
          </div>
          <button className="outline" onClick={() => setFilter('overdue')}>
            Review
          </button>
        </div>
      )}
      {canInstall && (
        <button className="install-banner" onClick={onInstall}>
          <span>⊕</span>
          <div>
            <strong>Install Khata</strong>
            <small>Add it to your home screen. It opens like an app, even offline.</small>
          </div>
          <b>Install</b>
        </button>
      )}
      <div className="hero">
        <div>
          <span className="eyebrow">Private workspace</span>
          <h1>Business overview</h1>
          <p>Your ledger stays in this browser on this device. Install it to use it like an app.</p>
        </div>
        <div className="hero-actions">
          <button className="primary" onClick={onAdd}>
            ＋ Add customer
          </button>
        </div>
      </div>
      <div className="stats">
        <Stat label="To give" value={totals.give} tone="red" hint="You owe others" />
        <Stat label="To take" value={totals.take} tone="green" hint="Customers owe you" />
        <Stat label="Overdue" value={totals.overdue} tone="blue" hint="Parties past due" count />
      </div>
      <div className="section-head">
        <div>
          <h2>People & accounts</h2>
          <small>
            {totalCount} contact{totalCount === 1 ? '' : 's'}
            {filter !== 'all' ? ` · ${customers.length} shown` : ''}
          </small>
        </div>
        <label className="search">
          ⌕
          <input
            ref={searchRef}
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder="Name, phone, note"
          />
        </label>
      </div>
      <div className="toolbar">
        {(['all', 'take', 'give', 'overdue', 'settled'] as ContactFilter[]).map(item => (
          <button key={item} className={filter === item ? 'chip active' : 'chip'} onClick={() => setFilter(item)}>
            {item === 'all' ? 'All' : item === 'take' ? 'To take' : item === 'give' ? 'To give' : item === 'overdue' ? 'Overdue' : 'Settled'}
          </button>
        ))}
        <select className="sort" value={sort} onChange={event => setSort(event.target.value as ContactSort)} aria-label="Sort contacts">
          <option value="recent">Recent</option>
          <option value="name">Name</option>
          <option value="take">Highest to take</option>
          <option value="give">Highest to give</option>
        </select>
      </div>
      {customers.length ? (
        <div className="contact-list">
          {customers.map(customer => {
            const value = balance(customer)
            const overdue = isOverdue(customer)
            return (
              <button className="contact" key={customer.id} onClick={() => onSelect(customer.id)}>
                <div className={`contact-avatar ${tone(customer.name)}`}>{initials(customer.name)}</div>
                <div className="contact-main">
                  <strong>
                    {customer.name}
                    {overdue && <em className="pill">Overdue</em>}
                  </strong>
                  <small>{customer.phone}</small>
                </div>
                <div className={`contact-balance ${value > 0 ? 'green' : value < 0 ? 'red' : ''}`}>
                  <strong>{value === 0 ? 'Settled' : `${value < 0 ? '-' : ''}${money(value)}`}</strong>
                  <small>{value > 0 ? 'To take' : value < 0 ? 'To give' : 'No balance'}</small>
                </div>
                <span className="chevron">›</span>
              </button>
            )
          })}
        </div>
      ) : (
        <div className="empty">
          <span>⌕</span>
          <h3>{query || filter !== 'all' ? 'No contacts found' : 'Your ledger is empty'}</h3>
          <p>{query || filter !== 'all' ? 'Try another search or filter.' : 'Add your first real customer to begin tracking credit.'}</p>
          {!query && filter === 'all' && (
            <button className="primary" onClick={onAdd}>
              ＋ Add first customer
            </button>
          )}
        </div>
      )}
    </section>
  )
}

import { Stat } from './Stat'

const SyncPage = lazy(() => import('./SyncPage'))

function Ledger({
  customer,
  business,
  upiId,
  onBack,
  onTransaction,
  onEditCustomer,
  onEditTransaction,
  onDeleteCustomer,
  onDeleteTransaction,
}: {
  customer: Customer
  business: string
  upiId: string
  onBack: () => void
  onTransaction: (type: TransactionType) => void
  onEditCustomer: () => void
  onEditTransaction: (tx: Transaction) => void
  onDeleteCustomer: () => void
  onDeleteTransaction: (transactionId: string) => void
}) {
  const value = balance(customer)
  const overdue = isOverdue(customer)
  const bucket = dueBucket(customer)
  const dueTotal = dueAmount(customer)
  const [txFilter, setTxFilter] = useState<'all' | TransactionType>('all')
  const [txQuery, setTxQuery] = useState('')
  const limit = customer.creditLimit
  const limitPct = limit ? Math.min(Math.round((Math.max(value, 0) / limit) * 100), 100) : 0
  const overLimit = limit !== undefined && value > limit
  const visibleTx = [...customer.transactions]
    .filter(tx => (txFilter === 'all' ? true : tx.type === txFilter))
    .filter(tx => {
      const q = txQuery.trim().toLowerCase()
      if (!q) return true
      return `${tx.note} ${tx.amount} ${formatDate(tx.date)}`.toLowerCase().includes(q)
    })
    .sort((a, b) => b.date.localeCompare(a.date))
  const upiHref = upiId.trim() && value > 0 ? upiPayLink(upiId, value, `${business} dues · ${customer.name}`) : ''
  const share = async () => {
    const text = statementText(business, customer)
    if (navigator.share) {
      try {
        await navigator.share({ title: `${customer.name} · Khata`, text })
        return
      } catch {
        /* user cancelled */
      }
    }
    await navigator.clipboard.writeText(text)
    alert('Statement copied to the clipboard.')
  }
  const printStatement = () => {
    const win = window.open('', '_blank')
    if (!win) return
    const rows = [...customer.transactions]
      .sort((a, b) => a.date.localeCompare(b.date))
      .map(
        tx =>
          `<tr><td>${formatDate(tx.date)}</td><td>${tx.type === 'credit' ? 'You gave' : 'You got'}</td><td>${tx.note || '—'}</td><td>${tx.type === 'credit' ? '+' : '-'}${money(tx.amount)}</td></tr>`,
      )
      .join('')
    win.document.write(`<!doctype html><title>${customer.name}</title><style>body{font-family:system-ui;padding:24px;color:#18202c}table{width:100%;border-collapse:collapse}td,th{border-bottom:1px solid #e8ebf1;padding:8px;text-align:left}h1{margin:0}</style><h1>${business}</h1><p>${customer.name} · ${customer.phone}</p><p><b>Balance ${value === 0 ? 'Settled' : `${value < 0 ? '-' : ''}${money(value)}`}</b></p><table><thead><tr><th>Date</th><th>Type</th><th>Note</th><th>Amount</th></tr></thead><tbody>${rows || '<tr><td colspan="4">No entries</td></tr>'}</tbody></table>`)
    win.document.close()
    win.focus()
    win.print()
  }
  return (
    <section className="ledger">
      <button className="back" onClick={onBack}>
        ← All contacts
      </button>
      <div className="profile">
        <div className={`profile-avatar ${tone(customer.name)}`}>{initials(customer.name)}</div>
        <div className="profile-copy">
          <h1>{customer.name}</h1>
          <p>{customer.phone}</p>
          {customer.address && <p>{customer.address}</p>}
        </div>
        <button className="delete-customer" onClick={onDeleteCustomer}>
          Delete customer
        </button>
      </div>
      <div className="quick-row">
        <a className="quick" href={telLink(customer.phone)}>
          Call
        </a>
        <a className="quick" href={waLink(customer.phone, reminderText(business, customer))} target="_blank" rel="noreferrer">
          WhatsApp
        </a>
        {upiHref && (
          <a className="quick collect" href={upiHref}>
            Collect {money(value)} via UPI
          </a>
        )}
        <button className="quick" onClick={() => void share()}>
          Share
        </button>
        <button className="quick" onClick={printStatement}>
          Print / PDF
        </button>
        <button className="quick" onClick={() => downloadCustomerCsv(customer)}>
          CSV
        </button>
        <button className="quick" onClick={onEditCustomer}>
          Edit
        </button>
      </div>
      <div className={`balance-card ${value < 0 ? 'negative' : ''} ${overdue ? 'overdue' : ''}`}>
        <div>
          <small>{value > 0 ? 'They owe you' : value < 0 ? 'You owe them' : 'All settled'}</small>
          <strong>
            {value < 0 ? '-' : ''}
            {money(value)}
          </strong>
        </div>
        <span>{overdue ? 'Overdue' : value === 0 ? 'Settled' : 'Outstanding'}</span>
      </div>
      {customer.note && <p className="party-note">{customer.note}</p>}
      {bucket !== 'none' && value > 0 && (
        <div className={`due-note ${bucket}`}>
          {bucket === 'overdue' && <>⚠ {money(dueTotal)} overdue — send a reminder today.</>}
          {bucket === 'due-today' && <>⏰ {money(dueTotal)} due today.</>}
          {bucket === 'due-soon' && <>📅 Payment due within 7 days.</>}
        </div>
      )}
      {limit !== undefined && (
        <div className={`limit-card ${overLimit ? 'over' : ''}`}>
          <div>
            <small>Credit limit</small>
            <strong>
              {money(value)} / {money(limit)}
            </strong>
          </div>
          <div className="limit-bar">
            <i style={{ width: `${limitPct}%` }} />
          </div>
          <span>{overLimit ? 'Over limit' : `${limitPct}% used`}</span>
        </div>
      )}
      <div className="section-head">
        <div>
          <h2>Transaction history</h2>
          <small>
            {visibleTx.length} of {customer.transactions.length} entr{customer.transactions.length === 1 ? 'y' : 'ies'}
          </small>
        </div>
        <label className="search mini">
          ⌕
          <input value={txQuery} onChange={event => setTxQuery(event.target.value)} placeholder="Filter entries" />
        </label>
      </div>
      <div className="toolbar">
        {(['all', 'credit', 'payment'] as const).map(item => (
          <button key={item} className={txFilter === item ? 'chip active' : 'chip'} onClick={() => setTxFilter(item)}>
            {item === 'all' ? 'All' : item === 'credit' ? 'You gave' : 'You got'}
          </button>
        ))}
      </div>
      {visibleTx.length ? (
        <div className="timeline">
          {visibleTx.map(tx => (
              <div className="transaction" key={tx.id}>
                <div className={`transaction-icon ${tx.type}`}>{tx.type === 'credit' ? '↑' : '↓'}</div>
                <div className="transaction-card">
                  <div>
                    <strong>{tx.type === 'credit' ? 'You gave' : 'You got'}</strong>
                    <small>{formatDate(tx.date)}</small>
                    <button className="delete-record" onClick={() => onEditTransaction(tx)}>
                      Edit
                    </button>
                    <button className="delete-record" aria-label="Delete record" onClick={() => onDeleteTransaction(tx.id)}>
                      Delete
                    </button>
                  </div>
                  <b className={tx.type}>
                    {tx.type === 'credit' ? '+' : '-'}
                    {money(tx.amount)}
                  </b>
                  {tx.note && <p>{tx.note}</p>}
                  {tx.dueDate && (
                    <p className={tx.type === 'credit' && isOverdue(customer) ? 'due-warn' : ''}>Due {formatDay(tx.dueDate)}</p>
                  )}
                  {tx.photo && <img src={tx.photo} alt="Bill" />}
                </div>
              </div>
            ))}
        </div>
      ) : (
        <div className="empty compact">
          <span>◷</span>
          <h3>{customer.transactions.length ? 'No entries match' : 'No transactions yet'}</h3>
          <p>{customer.transactions.length ? 'Clear the filter to see everything.' : 'Record the first entry below.'}</p>
        </div>
      )}
      <div className="ledger-actions">
        <button className="action red-action" onClick={() => onTransaction('credit')}>
          ↑ <b>You gave</b>
          <small>Goods or cash given</small>
        </button>
        <button className="action green-action" onClick={() => onTransaction('payment')}>
          ↓ <b>You got</b>
          <small>Payment or goods received</small>
        </button>
      </div>
    </section>
  )
}

function Reports({
  customers,
  totals,
  business,
  onSelect,
}: {
  customers: Customer[]
  totals: { take: number; give: number; overdue: number }
  business: string
  onSelect: (id: string) => void
}) {
  const now = new Date()
  const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const monthTx = customers.flatMap(customer =>
    customer.transactions
      .filter(tx => tx.date.startsWith(monthKey))
      .map(tx => ({ ...tx, customer })),
  )
  const gave = monthTx.filter(tx => tx.type === 'credit').reduce((sum, tx) => sum + tx.amount, 0)
  const got = monthTx.filter(tx => tx.type === 'payment').reduce((sum, tx) => sum + tx.amount, 0)
  const overdueParties = customers.filter(isOverdue).sort((a, b) => balance(b) - balance(a))
  const dueTodayParties = customers.filter(c => dueBucket(c) === 'due-today')
  const dueSoonParties = customers.filter(c => dueBucket(c) === 'due-soon')
  const months = lastMonths(6).map(m => {
    const txs = customers.flatMap(c => c.transactions.filter(tx => tx.date.startsWith(m.key)))
    return {
      ...m,
      gave: txs.filter(tx => tx.type === 'credit').reduce((s, tx) => s + tx.amount, 0),
      got: txs.filter(tx => tx.type === 'payment').reduce((s, tx) => s + tx.amount, 0),
    }
  })
  const maxMonth = Math.max(1, ...months.map(m => Math.max(m.gave, m.got)))
  const topTake = [...customers].filter(c => balance(c) > 0).sort((a, b) => balance(b) - balance(a)).slice(0, 5)
  const topGive = [...customers].filter(c => balance(c) < 0).sort((a, b) => balance(a) - balance(b)).slice(0, 5)
  const recent = customers
    .flatMap(customer => customer.transactions.map(tx => ({ tx, customer })))
    .sort((a, b) => b.tx.date.localeCompare(a.tx.date))
    .slice(0, 8)
  const copyOverdueReminders = async () => {
    const lines = overdueParties.map(c => `${c.name} (${c.phone}): ${reminderText(business, c)}`)
    const text = lines.join('\n\n')
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      alert(`${overdueParties.length} reminders copied. Paste them into WhatsApp or SMS.`)
    } catch {
      alert(text)
    }
  }

  return (
    <section>
      <div className="hero">
        <div>
          <span className="eyebrow">This month</span>
          <h1>Reports</h1>
          <p>Collections, dues, and recent activity — all from this device.</p>
        </div>
        {overdueParties.length > 0 && (
          <div className="hero-actions">
            <button className="primary" onClick={() => void copyOverdueReminders()}>
              Copy {overdueParties.length} overdue reminder{overdueParties.length === 1 ? '' : 's'}
            </button>
          </div>
        )}
      </div>
      <div className="stats">
        <Stat label="You gave" value={gave} tone="red" hint="Credit this month" />
        <Stat label="You got" value={got} tone="green" hint="Collections this month" />
        <Stat label="Net" value={totals.take - totals.give} tone="blue" hint="Across all accounts" />
      </div>
      <div className="card">
        <h2>Last 6 months</h2>
        <div className="bars">
          {months.map(m => (
            <div className="bar-col" key={m.key}>
              <div className="bar-pair">
                <i className="gave" style={{ height: `${Math.round((m.gave / maxMonth) * 72)}px` }} title={`Gave ${money(m.gave)}`} />
                <i className="got" style={{ height: `${Math.round((m.got / maxMonth) * 72)}px` }} title={`Got ${money(m.got)}`} />
              </div>
              <small>{m.label}</small>
            </div>
          ))}
        </div>
        <p className="muted legend">
          <b className="gave-dot">●</b> You gave · <b className="got-dot">●</b> You got
        </p>
      </div>
      <ReportList title="Due today" empty="Nothing due today." items={dueTodayParties} business={business} onSelect={onSelect} remind />
      <ReportList title="Due this week" empty="Nothing due in the next 7 days." items={dueSoonParties} business={business} onSelect={onSelect} remind />
      <ReportList title="Overdue collections" empty="No overdue accounts." items={overdueParties} business={business} onSelect={onSelect} remind />
      <ReportList title="Highest to take" empty="Nobody owes you right now." items={topTake} business={business} onSelect={onSelect} />
      <ReportList title="Highest to give" empty="You do not owe anyone." items={topGive} business={business} onSelect={onSelect} />
      <div className="section-head">
        <div>
          <h2>Recent activity</h2>
          <small>Latest {recent.length} entries</small>
        </div>
      </div>
      {recent.length ? (
        <div className="contact-list">
          {recent.map(({ tx, customer }) => (
            <button className="contact" key={tx.id} onClick={() => onSelect(customer.id)}>
              <div className={`contact-avatar ${tone(customer.name)}`}>{initials(customer.name)}</div>
              <div className="contact-main">
                <strong>{customer.name}</strong>
                <small>
                  {tx.type === 'credit' ? 'You gave' : 'You got'} · {formatDate(tx.date)}
                </small>
              </div>
              <div className={`contact-balance ${tx.type === 'credit' ? 'red' : 'green'}`}>
                <strong>
                  {tx.type === 'credit' ? '+' : '-'}
                  {money(tx.amount)}
                </strong>
              </div>
            </button>
          ))}
        </div>
      ) : (
        <div className="empty compact">
          <h3>No activity yet</h3>
          <p>New entries will show up here.</p>
        </div>
      )}
    </section>
  )
}

function ReportList({
  title,
  empty,
  items,
  business,
  onSelect,
  remind,
}: {
  title: string
  empty: string
  items: Customer[]
  business: string
  onSelect: (id: string) => void
  remind?: boolean
}) {
  return (
    <div className="report-block">
      <div className="section-head">
        <div>
          <h2>{title}</h2>
          <small>{items.length ? `${items.length} ${items.length === 1 ? 'party' : 'parties'}` : empty}</small>
        </div>
      </div>
      {items.length ? (
        <div className="contact-list">
          {items.map(customer => {
            const value = balance(customer)
            return (
              <div className="contact-row" key={customer.id}>
                <button className="contact grow" onClick={() => onSelect(customer.id)}>
                  <div className={`contact-avatar ${tone(customer.name)}`}>{initials(customer.name)}</div>
                  <div className="contact-main">
                    <strong>{customer.name}</strong>
                    <small>{customer.phone}</small>
                  </div>
                  <div className={`contact-balance ${value > 0 ? 'green' : 'red'}`}>
                    <strong>
                      {value < 0 ? '-' : ''}
                      {money(value)}
                    </strong>
                  </div>
                </button>
                {remind && value > 0 && (
                  <a
                    className="remind"
                    href={waLink(customer.phone, reminderText(business, customer))}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`Remind ${customer.name} on WhatsApp`}
                  >
                    Remind
                  </a>
                )}
              </div>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}

function SettingsPage({
  data,
  pwa,
  onSettings,
  onExport,
  onCsv,
  onImport,
  onClear,
  onLockNow,
  onIos,
}: {
  data: LedgerData
  pwa: ReturnType<typeof usePwaInstall>
  onSettings: (settings: Settings, message?: string) => void
  onExport: () => void
  onCsv: () => void
  onImport: () => void
  onClear: () => void
  onLockNow: () => void
  onIos: () => void
}) {
  const [businessName, setBusinessName] = useState(data.settings.businessName)
  const [upiId, setUpiId] = useState(data.settings.upiId || '')
  const [pin, setPin] = useState('')
  const saveName = (event: FormEvent) => {
    event.preventDefault()
    onSettings({ ...data.settings, businessName: businessName.trim() || 'My shop' }, 'Shop name saved')
  }
  const saveUpi = (event: FormEvent) => {
    event.preventDefault()
    const value = upiId.trim()
    if (value && !/^[\w.\-]{2,}@[a-zA-Z]{2,}$/.test(value)) return alert('Enter a valid UPI ID like shop@upi.')
    onSettings({ ...data.settings, upiId: value }, value ? 'UPI ID saved' : 'UPI ID removed')
  }
  const usageKb = Math.round(storageUsageBytes() / 1024)
  const txCount = data.customers.reduce((n, c) => n + c.transactions.length, 0)
  const setPinLock = async (event: FormEvent) => {
    event.preventDefault()
    if (!/^\d{4}$/.test(pin)) return alert('Choose a 4-digit PIN.')
    onSettings({ ...data.settings, lockEnabled: true, pinHash: await hashPin(pin) }, 'PIN lock enabled')
    setPin('')
  }
  return (
    <section className="settings">
      <div className="hero">
        <div>
          <span className="eyebrow">Workspace</span>
          <h1>Settings</h1>
          <p>Theme, lock, backups, and install. Nothing leaves this device unless you export it.</p>
        </div>
      </div>
      <div className="card">
        <h2>Appearance</h2>
        <div className="toolbar">
          {(['system', 'light', 'dark'] as const).map(theme => (
            <button
              key={theme}
              className={data.settings.theme === theme ? 'chip active' : 'chip'}
              onClick={() => onSettings({ ...data.settings, theme }, 'Theme updated')}
            >
              {theme[0].toUpperCase() + theme.slice(1)}
            </button>
          ))}
        </div>
      </div>
      <form className="card" onSubmit={saveName}>
        <h2>Shop name</h2>
        <label>
          Shown on statements and WhatsApp reminders
          <input value={businessName} onChange={event => setBusinessName(event.target.value)} maxLength={60} />
        </label>
        <button className="primary" type="submit">
          Save name
        </button>
      </form>
      <form className="card" onSubmit={saveUpi}>
        <h2>UPI collection</h2>
        <p className="muted">Customers get a one-tap “Collect via UPI” button for their exact dues.</p>
        <label>
          Your UPI ID
          <input value={upiId} onChange={event => setUpiId(event.target.value)} placeholder="shop@upi" autoCapitalize="off" autoCorrect="off" />
        </label>
        <button className="primary" type="submit">
          Save UPI ID
        </button>
      </form>
      <div className="card">
        <h2>Sync devices</h2>
        <p className="muted">
          {data.settings.lastSyncAt
            ? `Last synced ${new Date(data.settings.lastSyncAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}.`
            : 'Move your ledger between mobile and laptop with a 6-digit code.'}
        </p>
        <div className="hero-actions wrap">
          <button className="outline" onClick={() => go('/sync')}>
            Open sync
          </button>
        </div>
      </div>
      <div className="card">
        <h2>Install as an app</h2>
        <p className="muted">
          {pwa.installed
            ? 'Khata is running in app mode. Chrome will keep it updated in the background.'
            : 'Install from Chrome to hide the browser bar, work offline, and launch from your dock or home screen.'}
        </p>
        {pwa.canInstall && (
          <button className="primary" onClick={() => void pwa.install()}>
            Install Khata
          </button>
        )}
        {pwa.ios && (
          <button className="outline" onClick={onIos}>
            How to add on iPhone
          </button>
        )}
      </div>
      <form className="card" onSubmit={event => void setPinLock(event)}>
        <h2>PIN lock</h2>
        <p className="muted">Optional 4-digit lock for this browser profile. It is not a substitute for device encryption.</p>
        <label>
          4-digit PIN
          <input value={pin} onChange={event => setPin(event.target.value.replace(/\D/g, '').slice(0, 4))} inputMode="numeric" placeholder="••••" />
        </label>
        <div className="hero-actions">
          <button className="primary" type="submit">
            {data.settings.lockEnabled ? 'Update PIN' : 'Enable lock'}
          </button>
          {data.settings.lockEnabled && (
            <>
              <button
                className="outline"
                type="button"
                onClick={() => onSettings({ ...data.settings, lockEnabled: false, pinHash: '' }, 'PIN lock removed')}
              >
                Disable
              </button>
              <button className="outline" type="button" onClick={onLockNow}>
                Lock now
              </button>
            </>
          )}
        </div>
      </form>
      <div className="card">
        <h2>Backup</h2>
        <p className="muted">
          {data.customers.length} contacts · {txCount} entries · ~{usageKb} KB on this device. JSON restores the full workspace. CSV is for
          spreadsheets.
        </p>
        <div className="hero-actions wrap">
          <button className="outline" onClick={onExport}>
            Export JSON
          </button>
          <button className="outline" onClick={onCsv}>
            Export CSV
          </button>
          <button className="outline" onClick={onImport}>
            Import JSON
          </button>
          <button className="outline danger" onClick={onClear}>
            Clear workspace
          </button>
        </div>
      </div>
    </section>
  )
}

function LockScreen({ settings, onUnlock }: { settings: Settings; onUnlock: () => void }) {
  const [pin, setPin] = useState('')
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if ((await hashPin(pin)) === settings.pinHash) onUnlock()
    else alert('Incorrect PIN.')
  }
  return (
    <div className="lock-screen">
      <div className="brand-mark lg">K</div>
      <h1>Khata is locked</h1>
      <p>{settings.businessName}</p>
      <form onSubmit={event => void submit(event)}>
        <input
          autoFocus
          value={pin}
          onChange={event => setPin(event.target.value.replace(/\D/g, '').slice(0, 4))}
          inputMode="numeric"
          placeholder="PIN"
          aria-label="PIN"
        />
        <button className="primary full" type="submit">
          Unlock
        </button>
      </form>
    </div>
  )
}

function CustomerModal({
  existing,
  initial,
  onClose,
  onSave,
}: {
  existing: Customer[]
  initial: Customer | null
  onClose: () => void
  onSave: (customer: Customer) => void
}) {
  const [name, setName] = useState(initial?.name || '')
  const [phone, setPhone] = useState(initial?.phone || '')
  const [address, setAddress] = useState(initial?.address || '')
  const [note, setNote] = useState(initial?.note || '')
  const [creditLimit, setCreditLimit] = useState(initial?.creditLimit ? String(initial.creditLimit) : '')
  const submit = (event: FormEvent) => {
    event.preventDefault()
    const normalized = indianPhone(phone)
    if (name.trim().length < 2) return alert('Enter a customer name.')
    if (!normalized) return alert('Enter a valid 10-digit Indian mobile number.')
    const limit = creditLimit.trim() === '' ? undefined : Math.round(Number(creditLimit) * 100) / 100
    if (limit !== undefined && (!Number.isFinite(limit) || limit <= 0 || limit > 1000000000))
      return alert('Credit limit must be a positive amount, or left empty.')
    if (existing.some(customer => customer.id !== initial?.id && customer.phone.replace(/\D/g, '') === normalized.replace(/\D/g, '')))
      return alert('This phone number already exists.')
    onSave({
      id: initial?.id || id('customer'),
      name: name.trim(),
      phone: normalized,
      address: address.trim(),
      note: note.trim().slice(0, 300),
      createdAt: initial?.createdAt || new Date().toISOString(),
      creditLimit: limit,
      transactions: initial?.transactions || [],
    })
  }
  return (
    <Modal title={initial ? 'Edit customer' : 'Add customer'} subtitle="Account" onClose={onClose}>
      <form onSubmit={submit}>
        <label>
          Customer name
          <input autoFocus value={name} onChange={event => setName(event.target.value)} placeholder="e.g. Anita Mehta" required />
        </label>
        <label>
          Phone number <small>Indian number · +91 optional</small>
          <input value={phone} onChange={event => setPhone(event.target.value)} inputMode="tel" placeholder="98765 43210" required />
        </label>
        <label>
          Address <small>Optional</small>
          <input value={address} onChange={event => setAddress(event.target.value)} placeholder="Shop or village" />
        </label>
        <label>
          Note <small>Optional</small>
          <input value={note} onChange={event => setNote(event.target.value)} placeholder="Payment habit, GSTIN…" />
        </label>
        <label>
          Credit limit (₹) <small>Optional · warns when dues cross it</small>
          <input
            value={creditLimit}
            onChange={event => {
              const value = event.target.value.replace(/,/g, '')
              if (/^\d*(\.\d{0,2})?$/.test(value)) setCreditLimit(value)
            }}
            inputMode="decimal"
            placeholder="e.g. 10000"
          />
        </label>
        <button className="primary full" type="submit">
          {initial ? 'Save changes' : 'Create customer'}
        </button>
      </form>
    </Modal>
  )
}

function TransactionModal({
  type,
  initial,
  onClose,
  onSave,
}: {
  type: TransactionType
  initial: Transaction | null
  onClose: () => void
  onSave: (transaction: Transaction) => void
}) {
  const [amount, setAmount] = useState(initial ? String(initial.amount) : '')
  const [entryType, setEntryType] = useState<TransactionType>(initial?.type || type)
  const [date, setDate] = useState(
    initial
      ? new Date(new Date(initial.date).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16)
      : new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16),
  )
  const [note, setNote] = useState(initial?.note || '')
  const [photo, setPhoto] = useState(initial?.photo || '')
  const [dueDate, setDueDate] = useState(initial?.dueDate || '')
  const submit = (event: FormEvent) => {
    event.preventDefault()
    const numeric = Number(amount)
    if (!Number.isFinite(numeric) || numeric < 0.01 || numeric > 1000000000 || !/^\d+(\.\d{1,2})?$/.test(amount))
      return alert('Enter a valid amount with up to 2 decimal places.')
    const parsed = new Date(date)
    if (parsed > new Date() || Number.isNaN(parsed.getTime())) return alert('Choose a valid date and time.')
    onSave({
      id: initial?.id || id('transaction'),
      type: entryType,
      amount: Math.round(numeric * 100) / 100,
      date: parsed.toISOString(),
      note: note.trim().slice(0, 300),
      photo,
      dueDate: entryType === 'credit' ? dueDate : '',
    })
  }
  return (
    <Modal title={entryType === 'credit' ? 'You gave' : 'You got'} subtitle={initial ? 'Edit entry' : 'New entry'} onClose={onClose}>
      <form onSubmit={submit}>
        <div className="toolbar">
          <button type="button" className={entryType === 'credit' ? 'chip active' : 'chip'} onClick={() => setEntryType('credit')}>
            You gave
          </button>
          <button type="button" className={entryType === 'payment' ? 'chip active' : 'chip'} onClick={() => setEntryType('payment')}>
            You got
          </button>
        </div>
        <div className="amount-input">
          <span>₹</span>
          <input
            autoFocus
            value={amount}
            onChange={event => {
              const value = event.target.value.replace(/,/g, '')
              if (/^\d*(\.\d{0,2})?$/.test(value)) setAmount(value)
            }}
            inputMode="decimal"
            placeholder="0.00"
            required
          />
        </div>
        <div className="form-grid">
          <label>
            Date & time
            <input type="datetime-local" value={date} onChange={event => setDate(event.target.value)} required />
          </label>
          {entryType === 'credit' && (
            <label>
              Due date <small>Optional</small>
              <input type="date" value={dueDate} onChange={event => setDueDate(event.target.value)} />
            </label>
          )}
        </div>
        <label>
          Reference / note
          <input value={note} onChange={event => setNote(event.target.value)} placeholder="Optional" />
        </label>
        <label className="upload">
          <input
            type="file"
            accept="image/*"
            capture="environment"
            onChange={event => {
              const file = event.target.files?.[0]
              if (!file || file.size > 2 * 1024 * 1024) return alert('Image must be smaller than 2 MB.')
              const reader = new FileReader()
              reader.onload = () => setPhoto(String(reader.result))
              reader.readAsDataURL(file)
            }}
          />
          <span>▧</span>
          <b>{photo ? 'Bill photo attached' : 'Attach bill photo'}</b>
          <small>Optional · max 2 MB</small>
        </label>
        <button className="primary full" type="submit">
          Save {entryType === 'credit' ? 'credit' : 'payment'}
        </button>
      </form>
    </Modal>
  )
}

function IosInstallModal({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="Add to Home Screen" subtitle="iPhone / iPad" onClose={onClose}>
      <ol className="install-steps">
        <li>Tap the Share button in Safari.</li>
        <li>Choose Add to Home Screen.</li>
        <li>Tap Add. Khata opens in its own window next time.</li>
      </ol>
      <button className="primary full" onClick={onClose}>
        Got it
      </button>
    </Modal>
  )
}

function Modal({
  title,
  subtitle,
  onClose,
  children,
}: {
  title: string
  subtitle: string
  onClose: () => void
  children: React.ReactNode
}) {
  return (
    <div className="overlay" onMouseDown={event => event.target === event.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <div className="modal-head">
          <div>
            <span className="eyebrow">{subtitle}</span>
            <h2 id="modal-title">{title}</h2>
          </div>
          <button className="close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

export default App
