import { FormEvent, useEffect, useRef, useState } from 'react'
import type { MqttClient } from 'mqtt'
import type { Customer, LedgerData } from './types'
import { Stat } from './Stat'
import {
  buildPayload,
  clearPublished,
  closeRelay,
  makeCode,
  normalizeCode,
  publishLedger,
  receiveLedger,
  waitForAck,
  type SyncPayload,
} from './sync'
import { previewMerge, type MergePreview } from './merge'
import { downloadBackup } from './storage'

function goHome() {
  if (window.location.hash === '#/') window.dispatchEvent(new HashChangeEvent('hashchange'))
  else window.location.hash = '#/'
}

export default function SyncPage({
  data,
  onMerge,
  onReplace,
  onTouchSync,
}: {
  data: LedgerData
  onMerge: (customers: Customer[]) => void
  onReplace: (customers: Customer[]) => void
  onTouchSync: () => void
}) {
  const [mode, setMode] = useState<'menu' | 'send' | 'receive'>('menu')
  const lastSync = data.settings.lastSyncAt ? new Date(data.settings.lastSyncAt) : null
  return (
    <section className="settings">
      <div className="hero">
        <div>
          <span className="eyebrow">Devices</span>
          <h1>Sync</h1>
          <p>
            Move your ledger between mobile and laptop with a 6-digit code. No account, no cloud storage — data is
            encrypted end-to-end and the code is single-use.
          </p>
        </div>
      </div>
      {mode === 'menu' && (
        <>
          <div className="card">
            <h2>This device</h2>
            <p className="muted">
              {data.customers.length} contacts · {data.customers.reduce((n, c) => n + c.transactions.length, 0)} entries
              {lastSync ? ` · last synced ${lastSync.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}` : ' · never synced'}
            </p>
            <div className="hero-actions wrap">
              <button className="primary" onClick={() => setMode('send')}>
                Send to another device
              </button>
              <button className="outline" onClick={() => setMode('receive')}>
                Receive from another device
              </button>
            </div>
          </div>
          <div className="card">
            <h2>How it works</h2>
            <ol className="install-steps">
              <li>On the device that has the latest ledger, tap Send and read out the 6-digit code.</li>
              <li>On the other device, tap Receive and enter the code within a few minutes.</li>
              <li>Preview what will arrive, then Smart-merge (recommended) or Replace.</li>
            </ol>
            <p className="muted">A safety snapshot of this device is saved automatically before anything is applied.</p>
            <div className="hero-actions wrap">
              <button className="outline" onClick={() => downloadBackup(data)}>
                ↓ Export a backup first
              </button>
              <button className="outline" onClick={goHome}>
                ← Back to Home
              </button>
            </div>
          </div>
        </>
      )}
      {mode === 'send' && <SyncSend data={data} onBack={() => setMode('menu')} onTouchSync={onTouchSync} />}
      {mode === 'receive' && (
        <SyncReceive data={data} onBack={() => setMode('menu')} onMerge={onMerge} onReplace={onReplace} />
      )}
    </section>
  )
}

function SyncSend({ data, onBack, onTouchSync }: { data: LedgerData; onBack: () => void; onTouchSync: () => void }) {
  const [code, setCode] = useState('')
  const [phase, setPhase] = useState<'idle' | 'publishing' | 'waiting' | 'delivered' | 'error'>('idle')
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [error, setError] = useState('')
  const [waitingLong, setWaitingLong] = useState(false)
  const relay = useRef<{ client: MqttClient; chunks: number } | null>(null)
  const cancelled = useRef(false)

  useEffect(() => {
    cancelled.current = false
    return () => {
      cancelled.current = true
      if (relay.current) {
        clearPublished(relay.current.client, codeRef.current, relay.current.chunks)
        closeRelay(relay.current.client)
        relay.current = null
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const codeRef = useRef('')
  codeRef.current = code

  const start = async () => {
    const nextCode = makeCode()
    const session = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
    setCode(nextCode)
    codeRef.current = nextCode
    setError('')
    setWaitingLong(false)
    setPhase('publishing')
    setProgress({ done: 0, total: 0 })
    try {
      const { client, chunks } = await publishLedger(nextCode, buildPayload(data), session, (done, total) =>
        setProgress({ done, total }),
      )
      if (cancelled.current) {
        clearPublished(client, nextCode, chunks)
        closeRelay(client)
        return
      }
      relay.current = { client, chunks }
      setPhase('waiting')
      const timer = window.setTimeout(() => {
        if (!cancelled.current) setWaitingLong(true)
      }, 30000)
      const acked = await waitForAck(client, nextCode, 120000)
      window.clearTimeout(timer)
      if (cancelled.current) return
      if (acked) {
        setPhase('delivered')
        onTouchSync()
      } else {
        // Keep the code usable while the screen stays open; wait again.
        setWaitingLong(true)
        const again = await waitForAck(client, nextCode, 120000)
        if (!cancelled.current && again) {
          setPhase('delivered')
          onTouchSync()
        }
      }
    } catch (err) {
      if (!cancelled.current) {
        setError(err instanceof Error ? err.message : 'Sync failed. Please retry.')
        setPhase('error')
      }
    }
  }

  const cancel = () => {
    if (relay.current) {
      clearPublished(relay.current.client, codeRef.current, relay.current.chunks)
      closeRelay(relay.current.client)
      relay.current = null
    }
    onBack()
  }

  return (
    <div className="card">
      <h2>Send from this device</h2>
      {phase === 'idle' && (
        <>
          <p className="muted">
            {data.customers.length} contacts and {data.customers.reduce((n, c) => n + c.transactions.length, 0)} entries
            will be packed, encrypted, and shared under a fresh code.
          </p>
          <button className="primary" onClick={() => void start()}>
            Generate code
          </button>
        </>
      )}
      {phase === 'publishing' && (
        <>
          <p className="muted">
            Encrypting and uploading… {progress.done}/{progress.total || '…'}
          </p>
          <div className="limit-bar">
            <i style={{ width: progress.total ? `${Math.round((progress.done / progress.total) * 100)}%` : '8%' }} />
          </div>
        </>
      )}
      {(phase === 'waiting' || phase === 'delivered') && (
        <>
          <p className="muted">Enter this code on the other device:</p>
          <div className="sync-code">{code.split('').join(' ')}</div>
          {phase === 'waiting' && (
            <p className="muted">
              ⏳ Waiting for the other device… keep this screen open.
              {waitingLong ? ' The code stays valid while this screen is open.' : ''}
            </p>
          )}
          {phase === 'delivered' && <p className="sync-success">✓ Delivered and applied on the other device.</p>}
        </>
      )}
      {phase === 'error' && <p className="sync-error">{error}</p>}
      <div className="hero-actions wrap">
        {phase === 'error' && (
          <button className="primary" onClick={() => void start()}>
            Retry
          </button>
        )}
        <button className="outline" onClick={cancel}>
          {phase === 'delivered' ? 'Done' : 'Cancel'}
        </button>
        {phase === 'delivered' && (
          <button className="outline" onClick={goHome}>
            View ledger
          </button>
        )}
      </div>
    </div>
  )
}

function SyncReceive({
  data,
  onBack,
  onMerge,
  onReplace,
}: {
  data: LedgerData
  onBack: () => void
  onMerge: (customers: Customer[]) => void
  onReplace: (customers: Customer[]) => void
}) {
  const [code, setCode] = useState('')
  const [phase, setPhase] = useState<'input' | 'fetching' | 'preview' | 'done' | 'error'>('input')
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [error, setError] = useState('')
  const [payload, setPayload] = useState<SyncPayload | null>(null)
  const [preview, setPreview] = useState<MergePreview | null>(null)
  const [finisher, setFinisher] = useState<(() => void) | null>(null)

  const fetch = async (event: FormEvent) => {
    event.preventDefault()
    const clean = normalizeCode(code)
    if (clean.length !== 6) return alert('Enter the 6-digit code shown on the other device.')
    setError('')
    setPhase('fetching')
    setProgress({ done: 0, total: 0 })
    try {
      const { payload: incoming, clear } = await receiveLedger(clean, { id: null }, (done, total) =>
        setProgress({ done, total }),
      )
      setPayload(incoming)
      setPreview(previewMerge(data, incoming.customers))
      setFinisher(() => clear)
      setPhase('preview')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not fetch the ledger. Please retry.')
      setPhase('error')
    }
  }

  const apply = (kind: 'merge' | 'replace') => {
    if (!payload) return
    if (kind === 'replace' && !confirm(`Replace this device with ${payload.customers.length} contacts from ${payload.device}? A safety snapshot is kept automatically.`))
      return
    if (kind === 'merge') onMerge(payload.customers)
    else onReplace(payload.customers)
    finisher?.()
    setPhase('done')
  }

  const discard = () => {
    finisher?.()
    onBack()
  }

  return (
    <div className="card">
      <h2>Receive on this device</h2>
      {phase === 'input' && (
        <form onSubmit={event => void fetch(event)}>
          <label>
            6-digit code
            <input
              autoFocus
              value={code}
              onChange={event => setCode(normalizeCode(event.target.value))}
              inputMode="numeric"
              placeholder="••••••"
              aria-label="Sync code"
            />
          </label>
          <div className="hero-actions wrap">
            <button className="primary" type="submit">
              Fetch ledger
            </button>
            <button className="outline" type="button" onClick={onBack}>
              Back
            </button>
          </div>
        </form>
      )}
      {phase === 'fetching' && (
        <>
          <p className="muted">
            Downloading and decrypting… {progress.done}/{progress.total || '…'}
          </p>
          <div className="limit-bar">
            <i style={{ width: progress.total ? `${Math.round((progress.done / progress.total) * 100)}%` : '8%' }} />
          </div>
        </>
      )}
      {phase === 'preview' && payload && preview && (
        <>
          <p className="muted">
            From <b>{payload.device}</b> · sent {new Date(payload.exportedAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}
          </p>
          <div className="stats compact-stats">
            <Stat label="Contacts" value={preview.incomingCustomers} tone="blue" hint="incoming" count />
            <Stat label="New contacts" value={preview.addedCustomers} tone="green" hint="will be added" count />
            <Stat label="New entries" value={preview.addedTransactions} tone="green" hint="will be added" count />
          </div>
          {preview.updatedCustomers > 0 && (
            <p className="muted">{preview.updatedCustomers} existing contact{preview.updatedCustomers === 1 ? '' : 's'} will be updated (sender's details win).</p>
          )}
          {preview.addedCustomers === 0 && preview.addedTransactions === 0 && preview.updatedCustomers === 0 && (
            <p className="sync-success">Both devices already match — nothing to apply.</p>
          )}
          <div className="hero-actions wrap">
            <button className="primary" onClick={() => apply('merge')}>
              Smart-merge
            </button>
            <button className="outline" onClick={() => apply('replace')}>
              Replace this device
            </button>
            <button className="outline danger" onClick={discard}>
              Discard
            </button>
          </div>
        </>
      )}
      {phase === 'done' && (
        <>
          <p className="sync-success">✓ Sync applied. Your ledger is up to date on this device.</p>
          <div className="hero-actions wrap">
            <button className="primary" onClick={onBack}>
              Done
            </button>
            <button className="outline" onClick={goHome}>
              View ledger
            </button>
          </div>
        </>
      )}
      {phase === 'error' && (
        <>
          <p className="sync-error">{error}</p>
          <div className="hero-actions wrap">
            <button className="primary" onClick={() => setPhase('input')}>
              Retry
            </button>
            <button className="outline" onClick={onBack}>
              Back
            </button>
          </div>
        </>
      )}
    </div>
  )
}