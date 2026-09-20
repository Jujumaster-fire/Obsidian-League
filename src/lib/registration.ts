/**
 * Tournament registration channels & settings.
 *
 * Supports both global env var fallbacks and per-tournament admin configuration stored in
 * tournament.settings JSONB.
 */

export const REGISTRATION_WHATSAPP = (process.env.NEXT_PUBLIC_REGISTRATION_WHATSAPP ?? "").trim()
export const REGISTRATION_EMAIL = (process.env.NEXT_PUBLIC_REGISTRATION_EMAIL ?? "").trim()

export interface TournamentRegistrationSettings {
  contact_whatsapp?: string | null
  contact_email?: string | null
  contact_preference?: "whatsapp" | "email" | "both" | null
  registration_open?: boolean
  registration_deadline?: string | null
  eligibility?: string | null
  team_size_limit?: string | null
  entry_fee?: string | null
  registration_rules?: string | null
}

export interface RegistrationTarget {
  id?: string | null
  name?: string | null
  slug?: string | null
  edition?: string | null
  venue_city?: string | null
  start_date?: string | null
  end_date?: string | null
  settings?: TournamentRegistrationSettings | null
}

export const REGISTRATION_TEMPLATE = `Hello organisers,

We would like to register a team for {{TOURNAMENT}}.

Team name:
Category (Male / Female / Mixed / Open):
Sport / Discipline:
Head coach / Manager:
Contact phone:

Please confirm registration steps, guidelines, and next requirements.

Thank you.`

export function buildRegistrationMessage(target: RegistrationTarget = {}): string {
  const label = [target.name, target.edition].filter(Boolean).join(" — ")
  const venue = [target.venue_city ? `${target.venue_city}` : null].filter(Boolean).join("")

  const details: string[] = []
  if (target.start_date || target.end_date) {
    details.push(`Dates: ${target.start_date ?? "TBC"} to ${target.end_date ?? "TBC"}`)
  }
  if (venue) details.push(`Host city: ${venue}`)

  const header = details.length > 0 ? `${label || "the upcoming tournament"} (${details.join(" • ")})` : label

  return REGISTRATION_TEMPLATE.replace("{{TOURNAMENT}}", header || "the upcoming tournament")
}

export function buildWhatsAppUrl(target: RegistrationTarget = {}): string | null {
  const customNumber = target.settings?.contact_whatsapp
  const preference = target.settings?.contact_preference ?? "both"

  if (preference === "email") return null

  const rawNumber = (customNumber || REGISTRATION_WHATSAPP).replace(/\D/g, "")
  if (!rawNumber) return null

  return `https://wa.me/${rawNumber}?text=${encodeURIComponent(buildRegistrationMessage(target))}`
}

export function buildRegistrationMailto(target: RegistrationTarget = {}): string | null {
  const customEmail = target.settings?.contact_email
  const preference = target.settings?.contact_preference ?? "both"

  if (preference === "whatsapp") return null

  const email = (customEmail || REGISTRATION_EMAIL).trim()
  if (!email) return null

  const subject = target.name ? `Team registration — ${target.name}` : "Team registration"
  return `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(
    buildRegistrationMessage(target)
  )}`
}

export function hasRegistrationChannel(target: RegistrationTarget = {}): boolean {
  return Boolean(buildWhatsAppUrl(target) ?? buildRegistrationMailto(target))
}
