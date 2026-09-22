import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import Navigation from "@/components/Navigation"
import { cachedRestGet } from "@/lib/public-api"
import {
  buildRegistrationMailto,
  buildWhatsAppUrl,
  type RegistrationTarget,
} from "@/lib/registration"
import type { RegistrationAnnouncementData } from "@/components/PinnedRegistrationCard"

export const revalidate = 60

interface PageProps {
  params: Promise<{ slug: string }>
}

const getTournamentRegistration = async (slug: string) => {
  const rows = await cachedRestGet<RegistrationAnnouncementData>(
    `tournaments?select=id,name,slug,edition,venue_city,start_date,end_date,settings,sports(id,code,name,scoring_type)&slug=eq.${encodeURIComponent(
      slug
    )}&limit=1`,
    {
      revalidate: 60,
    }
  )
  return rows[0] ?? null
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params
  const tournament = await getTournamentRegistration(slug)

  if (!tournament) {
    return {
      title: "Registration Announcement | Obsidian Elite",
      description: "Tournament registration application details.",
    }
  }

  const label = [tournament.name, tournament.edition].filter(Boolean).join(" — ")

  return {
    title: `Register for ${label} | Obsidian Elite`,
    description: `Official team registrations are open for ${label}. View sports, rules, deadline and contact details.`,
    openGraph: {
      title: `Register for ${label} | Obsidian Elite`,
      description: `Official team registrations are open for ${label}. View sports, rules, deadline and contact details.`,
      type: "website",
      siteName: "Obsidian Elite",
    },
  }
}

export default async function RegistrationDetailPage({ params }: PageProps) {
  const { slug } = await params
  const tournament = await getTournamentRegistration(slug)

  if (!tournament) {
    notFound()
  }

  const target: RegistrationTarget = {
    id: tournament.id,
    name: tournament.name,
    slug: tournament.slug,
    edition: tournament.edition,
    venue_city: tournament.venue_city,
    start_date: tournament.start_date,
    end_date: tournament.end_date,
    settings: tournament.settings,
  }

  const whatsappUrl = buildWhatsAppUrl(target)
  const mailtoUrl = buildRegistrationMailto(target)

  const label = [tournament.name, tournament.edition].filter(Boolean).join(" — ")
  const settings = tournament.settings ?? {}

  return (
    <div className="min-h-screen bg-[#0f172a] text-white pb-32">
      <Navigation />

      <div className="pt-24 px-4 sm:px-6 lg:px-8 max-w-4xl mx-auto">
        <Link
          href="/news"
          className="inline-flex items-center gap-2 text-sm font-medium text-indigo-400 hover:text-indigo-300 transition-colors mb-8"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 17l-5-5m0 0l5-5m-5 5h12" />
          </svg>
          Back to Newsroom
        </Link>

        <article className="bg-[#1e293b] border border-white/10 rounded-2xl p-6 sm:p-10 shadow-2xl space-y-8">
          <header className="space-y-3 border-b border-white/10 pb-6">
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                OFFICIAL ANNOUNCEMENT &bull; REGISTRATION OPEN
              </span>
            </div>

            <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-white">
              {label}
            </h1>

            <p className="text-gray-400 text-sm sm:text-base">
              {[
                tournament.venue_city ? `Host City: ${tournament.venue_city}` : null,
                (tournament.start_date || tournament.end_date)
                  ? `Dates: ${tournament.start_date ?? "TBC"} to ${tournament.end_date ?? "TBC"}`
                  : null,
              ]
                .filter(Boolean)
                .join(" • ")}
            </p>
          </header>

          <section className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-[#0f172a] p-5 rounded-xl border border-white/5 text-sm">
            <div>
              <span className="text-gray-400 block font-medium uppercase text-xs">Registration Deadline</span>
              <span className="font-semibold text-white text-base">
                {settings.registration_deadline || "Open until slots filled"}
              </span>
            </div>
            <div>
              <span className="text-gray-400 block font-medium uppercase text-xs">Team Size Limit</span>
              <span className="font-semibold text-white text-base">
                {settings.team_size_limit || "Per sport squad limits"}
              </span>
            </div>
            <div>
              <span className="text-gray-400 block font-medium uppercase text-xs">Entry Fee</span>
              <span className="font-semibold text-white text-base">
                {settings.entry_fee || "Discuss with tournament agents"}
              </span>
            </div>
            <div>
              <span className="text-gray-400 block font-medium uppercase text-xs">Eligibility</span>
              <span className="font-semibold text-white text-base">
                {settings.eligibility || "Open to all registered clubs & university squads"}
              </span>
            </div>
          </section>

          {tournament.sports && tournament.sports.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-lg font-bold text-white">Sports & Competition Disciplines</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {tournament.sports.map((sport) => (
                  <div
                    key={sport.id}
                    className="p-3 bg-[#0f172a] rounded-xl border border-white/5 flex items-center justify-between"
                  >
                    <span className="font-semibold text-indigo-200">{sport.name}</span>
                    <span className="text-xs uppercase px-2 py-0.5 rounded bg-white/5 text-gray-400">
                      {sport.scoring_type}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {settings.registration_rules && (
            <section className="space-y-3">
              <h2 className="text-lg font-bold text-white">Registration Guidelines & Rules</h2>
              <p className="text-gray-300 leading-relaxed whitespace-pre-line bg-[#0f172a] p-5 rounded-xl border border-white/5">
                {settings.registration_rules}
              </p>
            </section>
          )}

          <section className="pt-6 border-t border-white/10 space-y-4">
            <h2 className="text-lg font-bold text-white">Contact Organisers & Register</h2>
            <p className="text-sm text-gray-300">
              Submit your team registration or reach out to tournament directors via WhatsApp or Email:
            </p>

            <div className="flex flex-wrap items-center gap-4">
              {whatsappUrl && (
                <a
                  href={whatsappUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 bg-[#25D366] text-[#0b3d20] font-bold py-3 px-6 rounded-xl hover:bg-[#1ebe5b] transition-colors text-sm shadow-lg"
                >
                  Register via WhatsApp
                </a>
              )}

              {mailtoUrl && (
                <a
                  href={mailtoUrl}
                  className="inline-flex items-center gap-2 bg-white text-indigo-900 font-bold py-3 px-6 rounded-xl hover:bg-indigo-50 transition-colors text-sm shadow-lg"
                >
                  Register via Email
                </a>
              )}
            </div>
          </section>
        </article>
      </div>
    </div>
  )
}
