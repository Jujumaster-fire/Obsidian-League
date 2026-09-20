'use client'

import { useEffect, useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { useAdminAuth } from '@/lib/use-admin-auth'
import { useOnboarding } from './onboarding-context'
import type { RoleId } from '@/lib/onboarding'

/**
 * First-run welcome.
 *
 * Shown once per browser (see `WELCOME_SEEN_KEY`) so a newcomer is greeted with
 * a short explanation of what the app is and how to get in, without ever
 * interrupting a returning operator. Every path here can also be reached from
 * the Guide link in the navigation, so nothing is lost if it is dismissed.
 */

interface Choice {
  id: string
  title: string
  detail: string
  role: RoleId
  href: string
  action: 'tour' | 'link'
}

const CHOICES: Choice[] = [
  {
    id: 'fan',
    title: 'Follow the action',
    detail: 'Live scores, fixtures, tables, squads, news and medal tables.',
    role: 'fan',
    href: '/competitions',
    action: 'tour',
  },
  {
    id: 'invite',
    title: 'I have an invite link',
    detail: 'Accept it to join a tournament with the duties you were offered.',
    role: 'user',
    href: '/login',
    action: 'link',
  },
  {
    id: 'staff',
    title: 'I run or log a tournament',
    detail: 'Register teams, schedule fixtures, run the live match console.',
    role: 'tournament_admin',
    href: '/admin',
    action: 'tour',
  },
]

export function WelcomeDialog() {
  const { startTour, completeWelcome } = useOnboarding()
  const { authenticated, isAppAdmin, memberships } = useAdminAuth()
  const [ready, setReady] = useState(false)
  const [choice, setChoice] = useState<Choice>(CHOICES[0])

  // Wait for the splash screen (2s) before covering the page with a modal.
  useEffect(() => {
    const timer = window.setTimeout(() => setReady(true), 2200)
    return () => window.clearTimeout(timer)
  }, [])

  if (!ready) return null

  const signedInAs = isAppAdmin
    ? 'app admin'
    : memberships.length > 0
      ? `tournament member (${memberships.length} tournament${memberships.length > 1 ? 's' : ''})`
      : null

  const confirm = () => {
    completeWelcome()
    if (choice.action === 'tour') startTour(choice.role)
  }

  return (
    <div
      className="fixed inset-0 z-[9997] flex items-center justify-center bg-[#020617]/85 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="welcome-title"
    >
      <div className="w-full max-w-xl rounded-2xl border border-white/10 bg-[#1e293b] p-6 shadow-2xl">
        <div className="flex items-center gap-3">
          <Image
            src="/logo-compressed.jpeg"
            alt="Obsidian Elite logo"
            width={40}
            height={40}
            className="h-10 w-10 rounded-lg object-cover"
          />
          <div>
            <h2 id="welcome-title" className="text-xl font-extrabold tracking-tight text-white">
              Welcome to Obsidian Elite
            </h2>
            <p className="text-xs text-gray-400">
              {signedInAs ? `Signed in as ${signedInAs}.` : 'Tournaments, live scoring and news in one place.'}
            </p>
          </div>
        </div>

        <p className="mt-4 text-sm leading-relaxed text-gray-300">
          Pick the closest match and we will give you a 60-second tour of the real controls — no
          account needed to watch, an account to follow, and an invite to help run a tournament.
        </p>

        <div className="mt-5 space-y-3" role="radiogroup" aria-label="Choose your starting point">
          {CHOICES.map((option) => {
            const selected = option.id === choice.id
            return (
              <button
                key={option.id}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => setChoice(option)}
                className={
                  'w-full rounded-xl border p-4 text-left transition ' +
                  (selected
                    ? 'border-indigo-400/70 bg-indigo-500/10'
                    : 'border-white/10 bg-white/5 hover:border-white/25')
                }
              >
                <span className="block text-sm font-semibold text-white">{option.title}</span>
                <span className="mt-1 block text-xs text-gray-400">{option.detail}</span>
              </button>
            )
          })}
        </div>

        {authenticated && !isAppAdmin && memberships.length === 0 ? (
          <p className="mt-4 rounded-lg border border-amber-400/20 bg-amber-500/10 p-3 text-xs text-amber-200">
            Your account has no staff access yet. An invite link from a tournament admin grants the
            exact duties you need.
          </p>
        ) : null}

        <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            onClick={completeWelcome}
            className="text-xs text-gray-400 underline decoration-dotted hover:text-white"
          >
            I do not need this — do not show again
          </button>
          <div className="flex items-center gap-3">
            <Link
              href="/onboarding"
              onClick={completeWelcome}
              className="rounded-lg border border-white/15 px-4 py-2 text-sm font-semibold text-gray-200 hover:bg-white/5"
            >
              Open the guide
            </Link>
            <button
              type="button"
              onClick={confirm}
              className="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-semibold text-white hover:bg-indigo-500"
            >
              {choice.action === 'tour' ? 'Take the tour' : 'Continue'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default WelcomeDialog
