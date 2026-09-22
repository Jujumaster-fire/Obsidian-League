"use client"

import { useState } from "react"
import Link from "next/link"
import {
  buildRegistrationMailto,
  buildWhatsAppUrl,
  type RegistrationTarget,
} from "@/lib/registration"

export interface RegistrationAnnouncementData {
  id: string
  name: string
  slug: string
  edition?: string | null
  venue_city?: string | null
  start_date?: string | null
  end_date?: string | null
  settings?: {
    contact_whatsapp?: string | null
    contact_email?: string | null
    contact_preference?: "whatsapp" | "email" | "both" | null
    registration_open?: boolean
    registration_deadline?: string | null
    eligibility?: string | null
    team_size_limit?: string | null
    entry_fee?: string | null
    registration_rules?: string | null
  } | null
  sports?: { id: string; code: string; name: string; scoring_type: string }[]
}

export function PinnedRegistrationCard({
  tournament,
}: {
  tournament: RegistrationAnnouncementData
}) {
  const [modalOpen, setModalOpen] = useState(false)

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
    <>
      <div className="mb-10 rounded-2xl bg-gradient-to-r from-indigo-900/90 via-purple-900/80 to-slate-900 border border-indigo-500/40 p-6 sm:p-8 shadow-2xl relative overflow-hidden">
        <div className="absolute top-0 right-0 -mt-10 -mr-10 w-48 h-48 bg-indigo-500/20 rounded-full blur-2xl pointer-events-none" />

        <div className="relative z-10 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
          <div className="space-y-2 flex-1">
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                PINNED ANNOUNCEMENT &bull; REGISTRATION OPEN
              </span>
            </div>

            <h2 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
              {label}
            </h2>

            <p className="text-indigo-200 text-sm sm:text-base max-w-3xl">
              Official team registrations are now open! Join competitive clubs across sports disciplines.
            </p>

            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-indigo-300/90 pt-1">
              {tournament.venue_city && (
                <span>📍 Host City: <strong>{tournament.venue_city}</strong></span>
              )}
              {(tournament.start_date || tournament.end_date) && (
                <span>📅 Dates: <strong>{tournament.start_date ?? "TBC"} → {tournament.end_date ?? "TBC"}</strong></span>
              )}
              {settings.registration_deadline && (
                <span>⏰ Deadline: <strong>{settings.registration_deadline}</strong></span>
              )}
            </div>
          </div>

          <div className="flex flex-wrap sm:flex-nowrap items-center gap-3 w-full md:w-auto shrink-0">
            <button
              type="button"
              onClick={() => setModalOpen(true)}
              className="flex-1 sm:flex-none bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-3 px-6 rounded-xl transition-all text-sm shadow-lg text-center"
            >
              Open Registration Details
            </button>
          </div>
        </div>
      </div>

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fadeIn">
          <div className="relative w-full max-w-2xl max-h-[90vh] overflow-y-auto bg-[#1e293b] border border-white/10 rounded-2xl p-6 sm:p-8 text-white shadow-2xl space-y-6">
            <button
              type="button"
              onClick={() => setModalOpen(false)}
              className="absolute top-4 right-4 text-gray-400 hover:text-white p-2 rounded-lg hover:bg-white/5 transition-colors"
            >
              ✕
            </button>

            <div>
              <span className="text-xs font-bold uppercase tracking-wider text-emerald-400">
                Tournament Registration Application
              </span>
              <h3 className="text-2xl sm:text-3xl font-extrabold mt-1 text-white">
                {label}
              </h3>
              <p className="text-sm text-gray-400 mt-1">
                {[
                  tournament.venue_city ? `Host City: ${tournament.venue_city}` : null,
                  (tournament.start_date || tournament.end_date)
                    ? `${tournament.start_date ?? "TBC"} to ${tournament.end_date ?? "TBC"}`
                    : null,
                ]
                  .filter(Boolean)
                  .join(" • ")}
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-[#0f172a] p-4 rounded-xl border border-white/5 text-xs text-gray-300">
              <div>
                <span className="text-gray-400 block font-medium uppercase">Deadline</span>
                <span className="font-semibold text-white text-sm">
                  {settings.registration_deadline || "Open until slots filled"}
                </span>
              </div>
              <div>
                <span className="text-gray-400 block font-medium uppercase">Team Size Limit</span>
                <span className="font-semibold text-white text-sm">
                  {settings.team_size_limit || "Per sport rules"}
                </span>
              </div>
              <div>
                <span className="text-gray-400 block font-medium uppercase">Entry Fee</span>
                <span className="font-semibold text-white text-sm">
                  {settings.entry_fee || "Discuss with tournament agents"}
                </span>
              </div>
              <div>
                <span className="text-gray-400 block font-medium uppercase">Eligibility</span>
                <span className="font-semibold text-white text-sm">
                  {settings.eligibility || "Open to all qualified clubs & university squads"}
                </span>
              </div>
            </div>

            {tournament.sports && tournament.sports.length > 0 && (
              <div>
                <h4 className="text-xs font-bold uppercase tracking-wide text-gray-400 mb-2">
                  Sports & Disciplines Included
                </h4>
                <div className="flex flex-wrap gap-2">
                  {tournament.sports.map((sport) => (
                    <span
                      key={sport.id}
                      className="px-3 py-1 bg-white/5 border border-white/10 rounded-full text-xs font-medium text-indigo-300"
                    >
                      {sport.name}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {settings.registration_rules && (
              <div>
                <h4 className="text-xs font-bold uppercase tracking-wide text-gray-400 mb-1">
                  Important Guidelines & Rules
                </h4>
                <p className="text-sm text-gray-300 whitespace-pre-line bg-[#0f172a] p-4 rounded-xl border border-white/5">
                  {settings.registration_rules}
                </p>
              </div>
            )}

            <div className="pt-4 border-t border-white/10 flex flex-col sm:flex-row items-center justify-between gap-4">
              <div className="flex flex-wrap items-center gap-3 w-full sm:w-auto">
                {whatsappUrl && (
                  <a
                    href={whatsappUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 sm:flex-none inline-flex items-center justify-center gap-2 bg-[#25D366] text-[#0b3d20] font-bold py-3 px-5 rounded-xl hover:bg-[#1ebe5b] transition-colors text-sm shadow-md"
                  >
                    WhatsApp Agent
                  </a>
                )}

                {mailtoUrl && (
                  <a
                    href={mailtoUrl}
                    className="flex-1 sm:flex-none inline-flex items-center justify-center gap-2 bg-white text-indigo-900 font-bold py-3 px-5 rounded-xl hover:bg-indigo-50 transition-colors text-sm shadow-md"
                  >
                    Email Organisers
                  </a>
                )}
              </div>

              <Link
                href={`/news/registration/${tournament.slug}`}
                className="text-xs text-indigo-300 hover:text-indigo-200 underline"
              >
                Read full announcement page →
              </Link>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
