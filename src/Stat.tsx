import { money } from './format'

export function Stat({
  label,
  value,
  tone: color,
  hint,
  count,
}: {
  label: string
  value: number
  tone: string
  hint: string
  count?: boolean
}) {
  return (
    <article className={`stat ${color}`}>
      <span>{label}</span>
      <strong>{count ? value : `${value < 0 ? '-' : ''}${money(value)}`}</strong>
      <small>{hint}</small>
    </article>
  )
}
