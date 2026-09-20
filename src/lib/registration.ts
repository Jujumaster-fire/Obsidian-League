/**
 * Tournament registration channels.
 *
 * The public "Register Your Team" banner sends teams straight to the organisers
 * instead of to a form nobody reads. Two channels are supported and both are
 * configured with public env vars so the marketing copy lives in Vercel rather
 * than in the bundle:
 *
 *   NEXT_PUBLIC_REGISTRATION_WHATSAPP=2348012345678   (digits only, intl format, no '+')
 *   NEXT_PUBLIC_REGISTRATION_EMAIL=entries@example.com
 *
 * When an env var is missing its button is simply not rendered, so a
 * half-configured deployment degrades instead of producing a broken link.
 */

export const REGISTRATION_WHATSAPP = (process.env.NEXT_PUBLIC_REGISTRATION_WHATSAPP ?? '').trim()
export const REGISTRATION_EMAIL = (process.env.NEXT_PUBLIC_REGISTRATION_EMAIL ?? '').trim()

export interface RegistrationTarget {
  name?: string | null
  edition?: string | null
  venue_city?: string | null
  start_date?: string | null
  end_date?: string | null
}

/**
 * Message template sent by WhatsApp / prefilled in the email.
 *
 * Kept in one place so organisers can edit the
 * wording — or translate it — without hunting through the JSX.
 */
export const REGISTRATION_TEMPLATE = `Hello Obsidian Elite organisers,

We would like to register a team for {{TOURNAMENT}}.

Team name:
Category (Male / Female / Mixed):
Sport (Football / Futsal / other):
Head coach:
Contact name & phone:
Preferred match window:

Please confirm the entry fee and the documents you need from us.

Thank you.`

/** Fill the template with the active tournament's details. */
export function buildRegistrationMessage(target: RegistrationTarget = {}): string {
  const label = [target.name, target.edition].filter(Boolean).join(' — ')
  const venue = [target.venue_city ? `${target.venue_city}` : null].filter(Boolean).join('')

  const details: string[] = []
  if (target.start_date || target.end_date) {
    details.push(`Dates: ${target.start_date ?? 'TBC'} to ${target.end_date ?? 'TBC'}`)
  }
  if (venue) details.push(`Host city: ${venue}`)

  const header = details.length > 0 ? `${label || 'the upcoming tournament'} (${details.join(' • ')})` : label

  return REGISTRATION_TEMPLATE.replace('{{TOURNAMENT}}', header || 'the upcoming tournament')
}

/** `null` when WhatsApp is not configured. */
export function buildWhatsAppUrl(target: RegistrationTarget = {}): string | null {
  const number = REGISTRATION_WHATSAPP.replace(/\D/g, '')
  if (!number) return null
  return `https://wa.me/${number}?text=${encodeURIComponent(buildRegistrationMessage(target))}`
}

/** `null` when the registration inbox is not configured. */
export function buildRegistrationMailto(target: RegistrationTarget = {}): string | null {
  if (!REGISTRATION_EMAIL) return null
  const subject =
    (target.name ? `Team registration — ${target.name}` : 'Team registration — Obsidian Elite')
  return `mailto:${REGISTRATION_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(
    buildRegistrationMessage(target)
  )}`
}

/** `true` when at least one registration channel is available. */
export function hasRegistrationChannel(): boolean {
  return Boolean(buildWhatsAppUrl({}) ?? buildRegistrationMailto({}))
}