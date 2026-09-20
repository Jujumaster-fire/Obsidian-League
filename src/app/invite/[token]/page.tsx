'use client'

import Link from 'next/link'
import { createClient } from '@/utils/supabase/client'
import { use, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { BrandedLoader } from '@/components/Skeleton'

interface InviteInfo {
  valid: boolean
  tournament_id?: string
  tournament_name?: string
  tournament_slug?: string
  duties?: string[]
  expires_at?: string
}

const DUTY_LABELS: Record<string, string> = {
  '*': 'Full tournament manager',
  score: 'Scores only',
  posts: 'News & posts',
}

/**
 * Public invite landing page.
 *
 * Reads the invite through `get_invite_info()` — a SECURITY DEFINER RPC that
 * exposes only the tournament name/slug/duties/expiry — so the raw
 * `tournament_invites` table (token owner, revocation metadata) is never
 * selectable from the browser. Accepting calls `accept_tournament_invite()`,
 * which grants membership + the `tournament_admin` role.
 */
export default function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params)
  const router = useRouter()
  const supabase = createClient()

  const [loading, setLoading] = useState(true)
  const [info, setInfo] = useState<InviteInfo | null>(null)
  const [signedInAs, setSignedInAs] = useState<string | null>(null)
  const [accepting, setAccepting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      const [{ data, error: rpcError }, { data: userData }] = await Promise.all([
        supabase.rpc('get_invite_info', { p_token: token }),
        supabase.auth.getUser(),
      ])

      if (cancelled) return

      if (rpcError) {
        setError(rpcError.message)
        setInfo({ valid: false })
      } else {
        setInfo((data as InviteInfo | null) ?? { valid: false })
      }
      setSignedInAs(userData.user?.email ?? null)
      setLoading(false)
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [supabase, token])

  const accept = async () => {
    setAccepting(true)
    setError(null)
    const { error: rpcError } = await supabase.rpc('accept_tournament_invite', { p_token: token })

    if (rpcError) {
      setError(rpcError.message)
      setAccepting(false)
      return
    }

    router.replace('/admin')
    router.refresh()
  }

  if (loading) return <BrandedLoader message="Loading invite…" />

  if (!info?.valid) {
    return (
      <div className="min-h-screen bg-[#0f172a] text-white flex items-center justify-center px-4 py-16">
        <div className="w-full max-w-md rounded-xl border border-white/5 bg-[#1e293b] p-8 text-center">
          <h1 className="text-2xl font-bold">Invite unavailable</h1>
          <p className="mt-2 text-sm text-gray-400">
            This invite link is expired, revoked, or does not exist. Ask a tournament manager for a
            fresh link.
          </p>
          {error && <p className="mt-3 text-xs text-red-400">{error}</p>}
          <Link
            href="/"
            className="mt-6 inline-block rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500"
          >
            Return home
          </Link>
        </div>
      </div>
    )
  }
const duties = info.duties ?? []

  return (
    <div className="min-h-screen bg-[#0f172a] text-white flex items-center justify-center px-4 py-16">
      <div className="w-full max-w-lg rounded-xl border border-white/5 bg-[#1e293b] p-8">
        <p className="text-xs font-semibold uppercase tracking-widest text-indigo-400">
          Tournament invite
        </p>
        <h1 className="mt-2 text-3xl font-extrabold tracking-tight">{info.tournament_name}</h1>
        {info.tournament_slug && (
          <p className="mt-1 text-sm text-gray-400">/{info.tournament_slug}</p>
        )}

        <dl className="mt-6 space-y-3 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-gray-400">Access</dt>
            <dd className="text-right font-medium">
              {duties.length > 0
                ? duties.map((duty) => DUTY_LABELS[duty] ?? duty).join(', ')
                : 'Full tournament manager'}
            </dd>
          </div>
          {info.expires_at && (
            <div className="flex justify-between gap-4">
              <dt className="text-gray-400">Expires</dt>
              <dd className="text-right font-medium">
                {new Date(info.expires_at).toLocaleString()}
              </dd>
            </div>
          )}
        </dl>

        {error && (
          <p className="mt-4 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
            {error}
          </p>
        )}

        <div className="mt-8 flex flex-col gap-3">
          {signedInAs ? (
            <>
              <p className="text-sm text-gray-400">
                Signed in as <span className="text-white">{signedInAs}</span>
              </p>
              <button
                type="button"
                onClick={accept}
                disabled={accepting}
                className="w-full rounded-md bg-green-600 px-4 py-3 text-sm font-semibold text-white hover:bg-green-500 disabled:opacity-60"
              >
                {accepting ? 'Accepting…' : 'Accept invite'}
              </button>
            </>
          ) : (
            <>
              <p className="text-sm text-gray-400">
                Sign in or create an account, then accept this invite to get tournament access.
              </p>
              <Link
                href={`/login?next=${encodeURIComponent(`/invite/${token}`)}`}
                className="w-full rounded-md bg-indigo-600 px-4 py-3 text-center text-sm font-semibold text-white hover:bg-indigo-500"
              >
                Sign in to accept
              </Link>
            </>
          )}
          <Link
            href="/"
            className="w-full rounded-md px-4 py-3 text-center text-sm font-semibold text-gray-300 ring-1 ring-inset ring-white/10 hover:bg-white/5"
          >
            Not now
          </Link>
        </div>
      </div>
    </div>
  )
}