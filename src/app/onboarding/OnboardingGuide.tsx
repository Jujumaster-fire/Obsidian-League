'use client'

import { useState, Suspense } from 'react'
import Link from 'next/link'
import { useSearchParams, useRouter } from 'next/navigation'
import { useAdminAuth } from '@/lib/use-admin-auth'
import { useOnboarding } from '@/components/onboarding/onboarding-context'
import {
  DUTY_DOCS,
  ROLES,
  dutyGlossaryForRole,
  featuresForRole,
  roleById,
  tourStepsForRole,
  type RoleId,
} from '@/lib/onboarding'

/**
 * The `/onboarding` guide: five role tabs (Fans · Users · Scouts · Tournament
 * admins · App admins), each with a journey and a feature catalogue. Same
 * interaction contract as `CompetitionsTabs`: the active tab is read from
 * `?role=` and written back with shallow routing.
 */

const VALID_ROLES = ROLES.map((role) => role.id)
const DEFAULT_ROLE: RoleId = 'fan'

function roleFromParams(raw: string | null): RoleId {
  return raw !== null && VALID_ROLES.includes(raw as RoleId) ? (raw as RoleId) : DEFAULT_ROLE
}

/** What the signed-in visitor actually holds, in onboarding terms. */
function describeVisitor(args: {
  loading: boolean
  isAppAdmin: boolean
  memberships: { duties: string[] | null }[]
}): string | null {
  if (args.loading) return null
  if (args.isAppAdmin) return 'You are signed in as an app admin.'
  const duties = args.memberships.flatMap((membership) => membership.duties ?? [])
  if (duties.length === 0) return null
  const pins = duties.filter((duty) => duty.startsWith('fixture:') || duty.includes('@'))
  const tokens = duties.filter((duty) => !duty.startsWith('fixture:') && !duty.includes('@'))
  if (pins.length > 0 && tokens.length === 0) {
    return `You are signed in with ${pins.length} fixture-scoped scout ${pins.length === 1 ? 'duty' : 'duties'}.`
  }
  if (
    tokens.length > 0 &&
    pins.length === 0 &&
    tokens.every((duty) => duty.startsWith('stat:') || duty.startsWith('event:'))
  ) {
    return 'You are signed in with stat/event scout duties.'
  }
  return `You are signed in with tournament access (${[...new Set(tokens)].slice(0, 3).join(', ')}${
    tokens.length > 3 ? ', …' : ''
  }).`
}

export function OnboardingGuideInner() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const { loading, isAppAdmin, memberships } = useAdminAuth()
  const { startTour, isActive } = useOnboarding()
  const [activeRole, setActiveRole] = useState<RoleId>(() => roleFromParams(searchParams.get('role')))

  const visitor = describeVisitor({ loading, isAppAdmin, memberships })

  const navigateTo = (role: RoleId) => {
    const url = new URL(window.location.href)
    if (role === DEFAULT_ROLE) {
      url.searchParams.delete('role')
    } else {
      url.searchParams.set('role', role)
    }
    router.push(url.pathname + url.search, { scroll: false })
    setActiveRole(role)
  }

  const role = roleById(activeRole)
  const features = featuresForRole(activeRole)
  const steps = tourStepsForRole(role.tourRole)
  const dutyRows = activeRole === 'scout' ? DUTY_DOCS : dutyGlossaryForRole(activeRole)

  return (
    <div className="space-y-10">
      {visitor ? (
        <p className="rounded-xl border border-indigo-400/30 bg-indigo-500/10 px-4 py-3 text-sm text-indigo-200">
          {visitor} The tabs below are filtered for you — switch roles any time to preview the other views.
        </p>
      ) : null}

      {/* Role tabs */}
      <div data-tour="guide-tabs" className="rounded-2xl border border-white/10 bg-[#1e293b] p-2">
        <div className="flex flex-wrap gap-1" role="tablist" aria-label="Onboarding roles">
          {ROLES.map((option) => {
            const selected = option.id === activeRole
            return (
              <button
                key={option.id}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => navigateTo(option.id)}
                className={
                  'flex-1 min-w-[140px] rounded-xl px-4 py-3 text-left transition ' +
                  (selected ? 'bg-indigo-600 text-white' : 'text-gray-300 hover:bg-white/5')
                }
              >
                <span className="block text-sm font-bold">{option.label}</span>
                <span className={'mt-0.5 block text-xs ' + (selected ? 'text-indigo-100' : 'text-gray-500')}>
                  {option.tagline}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Role summary + journey */}
      <section className="space-y-6">
        <div>
          <h2 className="text-2xl font-extrabold tracking-tight">{role.label}</h2>
          <p className="mt-2 max-w-3xl text-gray-300">{role.summary}</p>
        </div>

        <div className="rounded-2xl border border-white/10 bg-[#1e293b] p-6">
          <h3 className="text-sm font-bold uppercase tracking-widest text-indigo-300">
            Before you start
          </h3>
          <ul className="mt-3 space-y-2">
            {role.needs.map((need) => (
              <li key={need} className="flex gap-2 text-sm text-gray-300">
                <span aria-hidden="true" className="text-indigo-400">✓</span>
                <span>{need}</span>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h3 className="mb-3 text-lg font-bold">Your first session</h3>
          <ol className="grid gap-4 md:grid-cols-3">
            {role.journey.map((step, index) => (
              <li key={step.title} className="rounded-2xl border border-white/10 bg-[#1e293b] p-5">
                <span className="text-xs font-bold uppercase tracking-widest text-indigo-300">
                  Step {index + 1}
                </span>
                <p className="mt-1 font-bold text-white">{step.title}</p>
                <p className="mt-2 text-sm leading-relaxed text-gray-400">{step.detail}</p>
                {step.href ? (
                  <Link href={step.href} className="mt-3 inline-block text-sm font-semibold text-indigo-300 hover:text-indigo-200">
                    Open →
                  </Link>
                ) : null}
              </li>
            ))}
          </ol>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => startTour(role.tourRole)}
            disabled={isActive}
            className="rounded-xl bg-indigo-600 px-5 py-3 text-sm font-bold text-white hover:bg-indigo-500 disabled:opacity-50"
          >
            {isActive
              ? 'Tour running — follow the spotlight'
              : `Take the ${role.label.toLowerCase()} tour (${steps.length} stops)`}
          </button>
          <Link href="/" className="rounded-xl border border-white/15 px-5 py-3 text-sm font-semibold text-gray-200 hover:bg-white/5">
            Back to the hub
          </Link>
        </div>
      </section>

      {/* Feature catalogue */}
      <section>
        <h3 className="mb-1 text-lg font-bold">Everything {role.label.toLowerCase()} can use</h3>
        <p className="mb-4 text-sm text-gray-400">
          {features.length} feature{features.length === 1 ? '' : 's'} — what it does, how to reach it, and where it stops.
        </p>
        <div className="grid gap-4 md:grid-cols-2">
          {features.map((feature) => (
            <article key={feature.id} className="rounded-2xl border border-white/10 bg-[#1e293b] p-5">
              <div className="flex items-start justify-between gap-3">
                <h4 className="font-bold text-white">{feature.title}</h4>
                <code className="shrink-0 rounded-md bg-white/5 px-2 py-1 text-[11px] text-indigo-300">
                  {feature.route}
                </code>
              </div>
              <p className="mt-2 text-sm leading-relaxed text-gray-300">{feature.what}</p>
              <p className="mt-2 text-sm leading-relaxed text-gray-400">
                <span className="font-semibold text-gray-200">How: </span>
                {feature.how}
              </p>
              {feature.limits ? (
                <p className="mt-2 text-sm leading-relaxed text-gray-500">
                  <span className="font-semibold text-gray-400">Limits: </span>
                  {feature.limits}
                </p>
              ) : null}
              {feature.route.startsWith('/') && !feature.route.includes('[') ? (
                <Link href={feature.route} className="mt-3 inline-block text-sm font-semibold text-indigo-300 hover:text-indigo-200">
                  Open {feature.route} →
                </Link>
              ) : null}
            </article>
          ))}
        </div>
      </section>

      {/* Duty glossary — shown for staff roles that think in duties */}
      {(activeRole === 'scout' || activeRole === 'tournament_admin' || activeRole === 'app_admin') && (
        <section>
          <h3 className="mb-1 text-lg font-bold">The duty grammar, exactly as the database enforces it</h3>
          <p className="mb-4 text-sm text-gray-400">
            Your membership carries a duty list. This table is the full grammar from PART 13 —
            the guide cannot drift from it because it is tested against the source.
          </p>
          <div className="overflow-x-auto rounded-2xl border border-white/10">
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead>
                <tr className="border-b border-white/10 text-xs uppercase tracking-widest text-gray-400">
                  <th className="px-4 py-3">Duty</th>
                  <th className="px-4 py-3">Kind</th>
                  <th className="px-4 py-3">Grants</th>
                </tr>
              </thead>
              <tbody>
                {dutyRows.map((duty) => (
                  <tr key={duty.token} className="border-b border-white/5 last:border-0">
                    <td className="px-4 py-3 font-mono text-[13px] text-indigo-300">{duty.token}</td>
                    <td className="px-4 py-3 font-semibold text-white">{duty.kind}</td>
                    <td className="px-4 py-3 text-gray-300">{duty.can}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  )
}

/** Exported wrapper: `useSearchParams` requires a Suspense boundary. */
export function OnboardingGuide() {
  return (
    <Suspense fallback={<div className="py-20 text-center text-gray-400">Loading the guide…</div>}>
      <OnboardingGuideInner />
    </Suspense>
  )
}