// Manejo seguro de fechas tipo DATE (yyyy-mm-dd) sin desfases de zona horaria

/** Pinta un DATE ('YYYY-MM-DD') sin cambiar el día por timezone. */
export function fmtDateOnly(dateStr?: string | null, locale?: string) {
  if (!dateStr) return ''
  const [y, m, d] = dateStr.split('-').map(Number)
  const dt = new Date(y, (m ?? 1) - 1, d ?? 1) // crea en zona local
  return new Intl.DateTimeFormat(locale || undefined, {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).format(dt)
}

/** Devuelve hoy como 'YYYY-MM-DD' en zona local (útil para <input type="date">). */
export function todayDateOnly() {
  const d = new Date()
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

/** Devuelve un string DATE válido a partir del valor de un <input type="date">. */
export function fromDateInput(value: string) {
  // value YA viene como 'YYYY-MM-DD'; no lo conviertas a Date/ISO.
  return value
}

/** (Opcional) Formatea timestamptz uniformemente en local o UTC. */
export function fmtTimestamp(ts?: string | null, opts?: { utc?: boolean }) {
  if (!ts) return ''
  const d = new Date(ts)
  const fmt = new Intl.DateTimeFormat(undefined, {
    dateStyle: 'short',
    timeStyle: 'medium',
    ...(opts?.utc ? { timeZone: 'UTC' } : {}),
  }).format(d)
  return opts?.utc ? `${fmt} UTC` : fmt
}
