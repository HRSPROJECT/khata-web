import type { Customer } from './types'
import { balance, formatDate } from './format'

// Full account statement as a downloadable PDF.
// jsPDF is dynamically imported so the PDF engine loads only on demand.
// Note: jsPDF's built-in Helvetica covers WinAnsi only, so amounts use
// "Rs." instead of the ₹ glyph (U+20B9 is outside WinAnsi).

export function rs(value: number): string {
  return `Rs. ${new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(Math.abs(value))}`
}

export function balanceText(value: number): string {
  if (value === 0) return 'Settled'
  return `${value < 0 ? '-' : ''}${rs(value)}${value > 0 ? ' (to take)' : ' (to give)'}`
}

export async function downloadStatementPdf(business: string, customer: Customer): Promise<void> {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')])
  const txs = [...customer.transactions].sort((a, b) => a.date.localeCompare(b.date))
  const value = balance(customer)
  const totalGave = txs.filter(t => t.type === 'credit').reduce((s, t) => s + t.amount, 0)
  const totalGot = txs.filter(t => t.type === 'payment').reduce((s, t) => s + t.amount, 0)

  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
  const margin = 48
  let y = 56

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(20)
  doc.setTextColor(40, 44, 76)
  doc.text(business, margin, y)
  y += 20
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.setTextColor(120, 124, 140)
  doc.text('Khata statement of account', margin, y)
  y += 26

  doc.setFontSize(12)
  doc.setTextColor(30, 30, 30)
  doc.setFont('helvetica', 'bold')
  doc.text(customer.name, margin, y)
  y += 16
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.setTextColor(90, 90, 90)
  for (const line of [customer.phone, customer.address || '', customer.note ? `Note: ${customer.note}` : '']) {
    if (!line) continue
    doc.text(line, margin, y)
    y += 14
  }
  y += 6

  doc.setFillColor(238, 240, 255)
  doc.roundedRect(margin, y, doc.internal.pageSize.getWidth() - margin * 2, 64, 6, 6, 'F')
  y += 22
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.setTextColor(91, 101, 216)
  doc.text(`Balance: ${balanceText(value)}`, margin + 14, y)
  y += 16
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.setTextColor(90, 90, 90)
  doc.text(`Total given ${rs(totalGave)}   ·   Total received ${rs(totalGot)}   ·   ${txs.length} entries`, margin + 14, y)
  y += 30

  let running = 0
  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin },
    head: [['Date', 'Particulars', 'Given', 'Received', 'Balance']],
    body: txs.map(tx => {
      running += tx.type === 'credit' ? tx.amount : -tx.amount
      const label = tx.type === 'credit' ? 'You gave' : 'You got'
      return [
        formatDate(tx.date),
        tx.note ? `${label} - ${tx.note}` : label,
        tx.type === 'credit' ? rs(tx.amount) : '-',
        tx.type === 'payment' ? rs(tx.amount) : '-',
        `${running < 0 ? '-' : ''}${rs(running)}`,
      ]
    }),
    styles: { font: 'helvetica', fontSize: 9, cellPadding: 6, textColor: [40, 40, 40] },
    headStyles: { fillColor: [91, 101, 216], textColor: 255, fontStyle: 'bold' },
    columnStyles: {
      0: { cellWidth: 120 },
      2: { halign: 'right', cellWidth: 80 },
      3: { halign: 'right', cellWidth: 80 },
      4: { halign: 'right', cellWidth: 80 },
    },
    didDrawPage: () => {
      const pages = doc.getNumberOfPages()
      doc.setFontSize(9)
      doc.setTextColor(140, 140, 140)
      doc.text(
        `Generated ${new Date().toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })} · Page ${doc.getCurrentPageInfo().pageNumber} of ${pages}`,
        margin,
        doc.internal.pageSize.getHeight() - 30,
      )
    },
  })

  const safe = customer.name.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9-_]/g, '').slice(0, 40) || 'customer'
  doc.save(`Khata-Statement-${safe}-${new Date().toISOString().slice(0, 10)}.pdf`)
}
