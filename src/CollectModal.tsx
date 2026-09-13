import { useEffect, useState } from 'react'
import type { Customer } from './types'
import { balance, money, upiPayLink } from './format'

// UPI collection sheet: QR for the exact (or partial) dues, then the owner
// either marks it collected (records a "You got" entry), shares the pay link
// through the OS share sheet, or closes without recording anything.

export function CollectModal({
  customer,
  business,
  upiId,
  onClose,
  onCollected,
}: {
  customer: Customer
  business: string
  upiId: string
  onClose: () => void
  onCollected: (amount: number) => void
}) {
  const due = Math.round(balance(customer) * 100) / 100
  const [amount, setAmount] = useState(due > 0 ? String(due) : '')
  const [qrSvg, setQrSvg] = useState('')
  const [qrError, setQrError] = useState('')

  const numeric = Number(amount)
  const valid = Number.isFinite(numeric) && numeric >= 0.01 && numeric <= due
  const payLink = upiId.trim() && valid ? upiPayLink(upiId, numeric, `${business} dues · ${customer.name}`) : ''

  useEffect(() => {
    let cancelled = false
    setQrSvg('')
    setQrError('')
    if (!payLink) return
    ;(async () => {
      try {
        const { default: qrcode } = await import('qrcode-generator')
        if (cancelled) return
        const qr = qrcode(0, 'M')
        qr.addData(payLink)
        qr.make()
        if (!cancelled) setQrSvg(qr.createSvgTag({ cellSize: 6, margin: 0, scalable: true }))
      } catch {
        if (!cancelled) setQrError('Could not draw the QR. Use the Open UPI app link instead.')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [payLink])

  const share = async () => {
    const text = `Pay ${money(numeric)} to ${business} (dues for ${customer.name}) via UPI: ${payLink}`
    if (navigator.share) {
      try {
        await navigator.share({ title: `${customer.name} · UPI dues`, text })
        return
      } catch {
        return /* user cancelled — do not mark collected */
      }
    }
    try {
      await navigator.clipboard.writeText(text)
      alert('Pay link copied. Paste it into WhatsApp or SMS.')
    } catch {
      alert(text)
    }
  }

  const collect = () => {
    if (!valid) {
      alert(`Enter an amount between ₹0.01 and ${money(due)}.`)
      return
    }
    onCollected(Math.round(numeric * 100) / 100)
  }

  return (
    <div className="overlay" onMouseDown={event => event.target === event.currentTarget && onClose()}>
      <div className="modal collect-modal" role="dialog" aria-modal="true" aria-labelledby="collect-title">
        <div className="modal-head">
          <div>
            <span className="eyebrow">UPI collection</span>
            <h2 id="collect-title">Collect {money(due)}</h2>
          </div>
          <button className="close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        {!upiId.trim() ? (
          <>
            <p className="muted">Set your UPI ID first — the QR encodes payments to that ID.</p>
            <button className="primary full" onClick={onClose}>
              Close
            </button>
            <p className="muted">Find it under Settings → UPI collection.</p>
          </>
        ) : (
          <>
            <p className="muted">
              {customer.name} scans with any UPI app, or tap Open UPI app on this device. Nothing is recorded until
              you tap <b>Mark collected</b>.
            </p>
            <label>
              Amount to collect (₹)
              <input
                value={amount}
                onChange={event => {
                  const value = event.target.value.replace(/,/g, '')
                  if (/^\d*(\.\d{0,2})?$/.test(value)) setAmount(value)
                }}
                inputMode="decimal"
                placeholder="0.00"
              />
            </label>
            <div className="qr-box">
              {qrSvg ? (
                <div className="qr-svg" dangerouslySetInnerHTML={{ __html: qrSvg }} />
              ) : (
                <p className="muted">{qrError || 'Drawing QR…'}</p>
              )}
              <small>
                {upiId} · {valid ? money(numeric) : '—'}
              </small>
            </div>
            {payLink && (
              <a className="outline full collect-open" href={payLink}>
                Open UPI app
              </a>
            )}
            <div className="hero-actions wrap collect-actions">
              <button className="primary" onClick={collect} disabled={!valid}>
                ✓ Mark collected
              </button>
              <button className="outline" onClick={() => void share()} disabled={!valid}>
                Share
              </button>
              <button className="outline" onClick={onClose}>
                Close
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
