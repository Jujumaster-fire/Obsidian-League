'use client'

import Link from 'next/link'
import type { FormEvent, ReactNode } from 'react'
import { use, useCallback, useEffect, useMemo, useState } from 'react'
import { usePathname } from 'next/navigation'
import { createClient } from '@/utils/supabase/client'
import { useAdminAuth } from '@/lib/use-admin-auth'
import { dutyLabel, parseInviteDuties } from '@/lib/duties'
import { BrandedLoader } from '@/components/Skeleton'
import {
  TournamentAthletesManager,
  type AthleteRow,
} from '@/components/admin/AthleteEditor'

/**
 * /admin/tournaments/[id] — single tournament workspace.
 *
 * Everything scoped to one edition lives here: the `tournaments` overview row,
 * its `tournament_settings` row (upsert keyed on `tournament_id`), its
 * `tournament_posts` (news CRUD), invites and members (SECURITY DEFINER RPCs)
 * and — app admins only — the `tournament_sports` picker.
 *
 * Access is derived from `useAdminAuth()`: an app admin opens any edition, a
 * tournament member only the ones they belong to. Writes stay limited by the
 * duty list (`'*'` = full manager, `posts` = news) and RLS is the final
 * authority, so every failure is surfaced inline instead of thrown.
 */

type TournamentStatus = 'upcoming' | 'active' | 'archived'
type SettingsFormat = 'knockouts' | 'league' | 'group_to_knockout'

interface TournamentDetail {
  id: string
  name: string
  slug: string
  edition: string | null
  venue_city: string | null
  start_date: string | null
  end_date: string | null
  status: TournamentStatus
  is_active: boolean
}

interface OverviewDraft {
  name: string
  slug: string
  edition: string
  venue_city: string
  start_date: string
  end_date: string
  status: TournamentStatus
}

interface SettingsDraft {
  format: SettingsFormat
  table_arrangement: string
  rules: string
}

interface SettingsRow {
  format: SettingsFormat | null
  table_arrangement: string | null
  rules: string | null
}

interface PostRow {
  id: string
  title: string
  slug: string
  excerpt: string | null
  body: string | null
  image_url: string | null
  category: string | null
  published: boolean
  published_at: string | null
  created_at: string | null
}

interface PostDraft {
  title: string
  slug: string
  excerpt: string
  body: string
  image_url: string
  category: string
  published: boolean
}

interface MemberRow {
  membership_id: string
  user_id: string
  email: string | null
  duties: string[] | null
  granted_at: string | null
}

interface InviteRow {
  invite_id: string
  token: string
  duties: string[] | null
  expires_at: string | null
  revoked: boolean
  created_at: string | null
}

interface SportRow {
  id: string
  code: string
  name: string
  scoring_type: string
}

interface FixtureEntryRow {
  id: string
  fixture_id: string
  athlete_id: string | null
  team_id: string | null
  position: number
  lane: string | null
  rank: number | null
  medal: string | null
}

interface EntryDraft {
  fixture_id: string
  athlete_id: string
  position: string
  lane: string
  rank: string
  medal: string
}

interface TournamentFixtureRow {
  id: string
  status: string | null
  match_date: string | null
  home_team: { short_name: string | null } | null
  away_team: { short_name: string | null } | null
}

interface SportDraft {
  code: string
  name: string
  scoring_type: string
  stat_vocab: string
  event_vocab: string
}

const SCORING_TYPES = ['duel', 'sets', 'bouts', 'race', 'attempts'] as const

const EMPTY_SPORT_DRAFT: SportDraft = {
  code: '',
  name: '',
  scoring_type: 'duel',
  stat_vocab: '',
  event_vocab: '',
}

const MEDAL_OPTIONS = ['none', 'gold', 'silver', 'bronze'] as const

const EMPTY_ENTRY_DRAFT: EntryDraft = {
  fixture_id: '',
  athlete_id: '',
  position: '',
  lane: '',
  rank: '',
  medal: 'none',
}

const STATUS_OPTIONS: TournamentStatus[] = ['upcoming', 'active', 'archived']

const FORMAT_OPTIONS: { value: SettingsFormat; label: string }[] = [
  { value: 'league', label: 'League' },
  { value: 'knockouts', label: 'Knockouts' },
  { value: 'group_to_knockout', label: 'Group → knockout' },
]

/** Preset duties offered as one-click chips in the invite form. */
const DUTY_PRESETS: { label: string; value: string }[] = [
  { label: 'Full manager', value: '*' },
  { label: 'Stats & events', value: 'score stat:shots stat:passes event:*' },
  { label: 'Results & medals', value: 'entry' },
  { label: 'Lineups', value: 'lineup' },
  { label: 'News & posts', value: 'posts' },
]

/** Mirrors the `tournament_posts_slug_check` constraint. */
const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/

const EMPTY_OVERVIEW_DRAFT: OverviewDraft = {
  name: '',
  slug: '',
  edition: '',
  venue_city: '',
  start_date: '',
  end_date: '',
  status: 'upcoming',
}

const EMPTY_SETTINGS_DRAFT: SettingsDraft = {
  format: 'league',
  table_arrangement: '',
  rules: '',
}

const EMPTY_POST_DRAFT: PostDraft = {
  title: '',
  slug: '',
  excerpt: '',
  body: '',
  image_url: '',
  category: 'News',
  published: false,
}

const PANEL = 'bg-[#1e293b] rounded-xl border border-white/5 p-6'
const INPUT =
  'w-full rounded-lg border border-white/10 bg-[#0f172a] px-3 py-2 text-white focus:border-indigo-500 focus:outline-none'
const PRIMARY =
  'bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-60'
const DANGER =
  'bg-red-600 hover:bg-red-500 text-white rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-60'
const SECONDARY =
  'rounded-lg px-4 py-2 text-sm font-semibold text-gray-300 ring-1 ring-inset ring-white/10 hover:bg-white/5 disabled:opacity-60'
const SUBTLE =
  'rounded-lg border border-white/10 px-3 py-1.5 text-xs font-medium text-gray-300 hover:bg-white/5 disabled:opacity-60'

/** Lowercase, non-alphanumerics to dashes, trimmed, runs collapsed. */
const slugify = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

const orNull = (value: string) => {
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

const hasDuty = (duties: string[] | null | undefined, duty: string) =>
  Boolean(duties && (duties.includes('*') || duties.includes(duty)))

const formatDate = (value: string | null | undefined) => {
  if (!value) return 'Not set'
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T00:00:00`)
    : new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString()
}

const formatDateTime = (value: string | null | undefined) => {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

const formatDuties = (duties: string[] | null | undefined) =>
  duties && duties.length > 0
    ? duties.map((duty) => dutyLabel(duty)).join(', ')
    : 'No duties recorded'

const isExpired = (value: string | null) => {
  if (!value) return false
  const date = new Date(value)
  return !Number.isNaN(date.getTime()) && date.getTime() < Date.now()
}

/** Centered panel used for the sign-in / no-access / not-found states. */
function GatePanel({
  title,
  body,
  href,
  action,
}: {
  title: string
  body: string
  href: string
  action: string
}) {
  return (
    <div className="min-h-screen bg-[#0f172a] text-white pb-24">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-24">
        <div className="mx-auto max-w-lg bg-[#1e293b] rounded-xl border border-white/5 p-8 text-center">
          <h1 className="text-2xl font-bold">{title}</h1>
          <p className="mt-2 text-sm text-gray-400">{body}</p>
          <Link href={href} className={`mt-6 inline-block ${PRIMARY}`}>
            {action}
          </Link>
        </div>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-400">
        {label}
      </span>
      {children}
    </label>
  )
}

function Section({
  title,
  description,
  children,
  aside,
  tour,
}: {
  title: string
  description?: string
  children: ReactNode
  aside?: ReactNode
  /** Optional `data-tour` anchor for the guided tour. */
  tour?: string
}) {
  return (
    <section {...(tour ? { 'data-tour': tour } : {})} className={PANEL}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold">{title}</h2>
          {description ? <p className="mt-1 text-sm text-gray-400">{description}</p> : null}
        </div>
        {aside}
      </div>
      <div className="mt-5">{children}</div>
    </section>
  )
}

function PostFormFields({
  draft,
  onChange,
  disabled,
  slugEdited,
  onSlugEdited,
}: {
  draft: PostDraft
  onChange: (patch: Partial<PostDraft>) => void
  disabled: boolean
  slugEdited: boolean
  onSlugEdited: () => void
}) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <Field label="Title">
        <input
          className={INPUT}
          value={draft.title}
          disabled={disabled}
          onChange={(event) => {
            const title = event.target.value
            onChange({ title, ...(slugEdited ? {} : { slug: slugify(title) }) })
          }}
        />
      </Field>
      <Field label="Slug">
        <input
          className={INPUT}
          value={draft.slug}
          disabled={disabled}
          onChange={(event) => {
            onSlugEdited()
            onChange({ slug: slugify(event.target.value) })
          }}
        />
      </Field>
      <Field label="Category">
        <input
          className={INPUT}
          value={draft.category}
          disabled={disabled}
          onChange={(event) => onChange({ category: event.target.value })}
        />
      </Field>
      <Field label="Image URL">
        <input
          className={INPUT}
          value={draft.image_url}
          disabled={disabled}
          onChange={(event) => onChange({ image_url: event.target.value })}
        />
      </Field>
      <div className="sm:col-span-2">
        <Field label="Excerpt">
          <textarea
            className={`${INPUT} min-h-[70px]`}
            value={draft.excerpt}
            disabled={disabled}
            onChange={(event) => onChange({ excerpt: event.target.value })}
          />
        </Field>
      </div>
      <div className="sm:col-span-2">
        <Field label="Body">
          <textarea
            className={`${INPUT} min-h-[140px]`}
            value={draft.body}
            disabled={disabled}
            onChange={(event) => onChange({ body: event.target.value })}
          />
        </Field>
      </div>
      <label className="flex items-center gap-2 text-sm text-gray-300">
        <input
          type="checkbox"
          className="h-4 w-4 rounded border-white/20 bg-[#0f172a]"
          checked={draft.published}
          disabled={disabled}
          onChange={(event) => onChange({ published: event.target.checked })}
        />
        Publish immediately
      </label>
    </div>
  )
}

export default function TournamentWorkspacePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = use(params)
  const supabase = useMemo(() => createClient(), [])
  const {
    loading: authLoading,
    authenticated,
    canAccessAdmin,
    isAppAdmin,
    memberships,
  } = useAdminAuth()
  const pathname = usePathname()

  const membership = memberships.find((row) => row.tournament_id === id)
  const canManageInvites = isAppAdmin || hasDuty(membership?.duties, '*')
  const canWritePosts = isAppAdmin || hasDuty(membership?.duties, 'posts')

  const [loading, setLoading] = useState(true)
  const [missing, setMissing] = useState(false)
  const [tournament, setTournament] = useState<TournamentDetail | null>(null)
  const [overviewDraft, setOverviewDraft] = useState<OverviewDraft>(EMPTY_OVERVIEW_DRAFT)
  const [settingsDraft, setSettingsDraft] = useState<SettingsDraft>(EMPTY_SETTINGS_DRAFT)
  const [posts, setPosts] = useState<PostRow[]>([])
  const [postDraft, setPostDraft] = useState<PostDraft>(EMPTY_POST_DRAFT)
  const [slugEdited, setSlugEdited] = useState(false)
  const [editingPostId, setEditingPostId] = useState<string | null>(null)
  const [members, setMembers] = useState<MemberRow[]>([])
  const [invites, setInvites] = useState<InviteRow[]>([])
  const [sports, setSports] = useState<SportRow[]>([])
  const [selectedSportIds, setSelectedSportIds] = useState<string[]>([])
  const [athletes, setAthletes] = useState<AthleteRow[]>([])
  const [entries, setEntries] = useState<FixtureEntryRow[]>([])
  const [fixtures, setFixtures] = useState<TournamentFixtureRow[]>([])
  const [entryDraft, setEntryDraft] = useState<EntryDraft>(EMPTY_ENTRY_DRAFT)
  const [confirmEntryId, setConfirmEntryId] = useState<string | null>(null)
  const [sportDraft, setSportDraft] = useState<SportDraft>(EMPTY_SPORT_DRAFT)
  // Visible, editable copy for the text input so users can type multi-duty tokens.
  const [inviteDutyInput, setInviteDutyInput] = useState('*')
  const [inviteExpiryDays, setInviteExpiryDays] = useState('7')
  const [confirmPostId, setConfirmPostId] = useState<string | null>(null)
  const [confirmInviteId, setConfirmInviteId] = useState<string | null>(null)
  const [copiedToken, setCopiedToken] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const fail = (message: string) => {
    setError(message)
    setNotice(null)
  }

  const succeed = (message: string) => {
    setNotice(message)
    setError(null)
  }

  /** Bust the cached public reads so edits appear immediately. */
  const bustCache = async () => {
    try {
      await fetch('/api/revalidate', { method: 'POST' })
    } catch {
      // best effort — the 30-60s revalidation window still converges
    }
  }

  const loadAll = useCallback(async () => {
    setLoading(true)
    setError(null)

    const { data: tournamentRow, error: tournamentError } = await supabase
      .from('tournaments')
      .select('id, name, slug, edition, venue_city, start_date, end_date, status, is_active')
      .eq('id', id)
      .maybeSingle()

    if (tournamentError) {
      fail(`Could not load this tournament: ${tournamentError.message}`)
      setLoading(false)
      return
    }

    if (!tournamentRow) {
      setMissing(true)
      setLoading(false)
      return
    }

    const detail = tournamentRow as unknown as TournamentDetail
    setTournament(detail)
    setOverviewDraft({
      name: detail.name ?? '',
      slug: detail.slug ?? '',
      edition: detail.edition ?? '',
      venue_city: detail.venue_city ?? '',
      start_date: detail.start_date ?? '',
      end_date: detail.end_date ?? '',
      status: detail.status ?? 'upcoming',
    })

    const [settingsRes, postsRes, memberRes, inviteRes, sportRes, linkRes, athleteRes] = await Promise.all([
      supabase
        .from('tournament_settings')
        .select('format, table_arrangement, rules')
        .eq('tournament_id', id)
        .maybeSingle(),
      supabase
        .from('tournament_posts')
        .select('id, title, slug, excerpt, body, image_url, category, published, published_at, created_at')
        .eq('tournament_id', id)
        .order('created_at', { ascending: false }),
      supabase.rpc('list_tournament_members', { p_tournament_id: id }),
      supabase.rpc('list_tournament_invites', { p_tournament_id: id }),
      supabase.from('sports').select('id, code, name, scoring_type').order('name'),
      supabase.from('tournament_sports').select('sport_id').eq('tournament_id', id),
      supabase.from('athletes').select('id, tournament_id, name, gender, classification, team_id, sport_id').eq('tournament_id', id).order('name'),

    ])

    const settings = settingsRes.data as SettingsRow | null
    setSettingsDraft({
      format: (settings?.format as SettingsFormat) ?? 'league',
      table_arrangement: settings?.table_arrangement ?? '',
      rules: settings?.rules ?? '',
    })

    setPosts((Array.isArray(postsRes.data) ? postsRes.data : []) as PostRow[])
    setMembers((Array.isArray(memberRes.data) ? memberRes.data : []) as MemberRow[])
    setInvites((Array.isArray(inviteRes.data) ? inviteRes.data : []) as InviteRow[])
    setSports((Array.isArray(sportRes.data) ? sportRes.data : []) as SportRow[])
    setAthletes((Array.isArray(athleteRes.data) ? athleteRes.data : []) as AthleteRow[])

    // Load entries and fixtures sequentially: need fixture IDs first for the entries filter.
    const fixturesRes = await supabase
      .from('fixtures')
      .select('id, home_team_id, away_team_id, status, match_date, home_team:name,home_team_id(short_name),away_team:name,away_team_id(short_name)')
      .eq('tournament_id', id)
      .order('match_date')
    const fixtureRows = Array.isArray(fixturesRes.data) ? fixturesRes.data : []
    setFixtures(fixtureRows as TournamentFixtureRow[])
    const fixtureIds = fixtureRows
      .map((f: { id: string }) => f.id)
      .filter(Boolean)

    const entryRes = fixtureIds.length > 0
      ? await supabase.from('fixture_entries').select('id, fixture_id, athlete_id, team_id, position, lane, rank, medal').in('fixture_id', fixtureIds)
      : { data: [] }
    setEntries((Array.isArray(entryRes.data) ? entryRes.data : []) as FixtureEntryRow[])

    setSelectedSportIds(
      (Array.isArray(linkRes.data) ? linkRes.data : [])
        .map((row: { sport_id?: string }) => row.sport_id)
        .filter((value): value is string => Boolean(value))
    )

    setLoading(false)
  }, [id, supabase])

  useEffect(() => {
    if (authLoading || !canAccessAdmin) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data-loading effect: fetch then set state once
    void loadAll()
  }, [authLoading, canAccessAdmin, loadAll])

/** Overview / settings / posts handlers. */

  const saveOverview = async (event: FormEvent) => {
    event.preventDefault()
    if (!tournament) return
    if (!overviewDraft.name.trim() || !overviewDraft.slug.trim()) {
      fail('Name and slug are required.')
      return
    }

    setBusy(true)
    const { error: updateError } = await supabase
      .from('tournaments')
      .update({
        name: overviewDraft.name.trim(),
        slug: slugify(overviewDraft.slug),
        edition: orNull(overviewDraft.edition),
        venue_city: orNull(overviewDraft.venue_city),
        start_date: orNull(overviewDraft.start_date),
        end_date: orNull(overviewDraft.end_date),
        status: overviewDraft.status,
      })
      .eq('id', tournament.id)
    setBusy(false)

    if (updateError) {
      fail(`Could not save the overview: ${updateError.message}`)
      return
    }

    succeed('Tournament overview saved.')
    await bustCache()
    await loadAll()
  }

  const saveSettings = async (event: FormEvent) => {
    event.preventDefault()
    if (!tournament) return

    setBusy(true)
    const { error: upsertError } = await supabase
      .from('tournament_settings')
      .upsert(
        {
          tournament_id: tournament.id,
          format: settingsDraft.format,
          table_arrangement: orNull(settingsDraft.table_arrangement),
          rules: orNull(settingsDraft.rules),
        },
        { onConflict: 'tournament_id' }
      )
    setBusy(false)

    if (upsertError) {
      fail(`Could not save the settings: ${upsertError.message}`)
      return
    }

    succeed('Tournament settings saved.')
    await bustCache()
  }

  const resetPostForm = () => {
    setEditingPostId(null)
    setSlugEdited(false)
    setPostDraft(EMPTY_POST_DRAFT)
  }

  const beginPostEdit = (post: PostRow) => {
    setEditingPostId(post.id)
    setSlugEdited(true)
    setPostDraft({
      title: post.title ?? '',
      slug: post.slug ?? '',
      excerpt: post.excerpt ?? '',
      body: post.body ?? '',
      image_url: post.image_url ?? '',
      category: post.category ?? 'News',
      published: Boolean(post.published),
    })
  }

  const savePost = async (event: FormEvent) => {
    event.preventDefault()
    if (!tournament) return

    const title = postDraft.title.trim()
    const slug = slugify(postDraft.slug || title)

    if (!title) {
      fail('A post needs a title.')
      return
    }
    if (!SLUG_PATTERN.test(slug)) {
      fail('The slug may only contain lowercase letters, numbers and single dashes.')
      return
    }

    setBusy(true)
    const payload = {
      tournament_id: tournament.id,
      title,
      slug,
      excerpt: orNull(postDraft.excerpt),
      body: orNull(postDraft.body),
      image_url: orNull(postDraft.image_url),
      category: postDraft.category.trim() || 'News',
      published: postDraft.published,
      published_at: postDraft.published ? new Date().toISOString() : null,
    }

    const { error: writeError } = editingPostId
      ? await supabase.from('tournament_posts').update(payload).eq('id', editingPostId)
      : await supabase.from('tournament_posts').insert(payload)
    setBusy(false)

    if (writeError) {
      fail(`Could not save the post: ${writeError.message}`)
      return
    }

    succeed(editingPostId ? 'Post updated.' : 'Post created.')
    resetPostForm()
    await bustCache()
    await loadAll()
  }

  const togglePostPublished = async (post: PostRow) => {
    const nextPublished = !post.published
    setBusy(true)
    const { error: updateError } = await supabase
      .from('tournament_posts')
      .update({
        published: nextPublished,
        published_at: nextPublished ? post.published_at ?? new Date().toISOString() : post.published_at,
      })
      .eq('id', post.id)
    setBusy(false)

    if (updateError) {
      fail(`Could not change the post status: ${updateError.message}`)
      return
    }

    setPosts((current) =>
      current.map((row) => (row.id === post.id ? { ...row, published: nextPublished } : row))
    )
    succeed(nextPublished ? 'Post published.' : 'Post unpublished.')
    await bustCache()
  }

  const deletePost = async (post: PostRow) => {
    if (confirmPostId !== post.id) {
      setConfirmPostId(post.id)
      return
    }

    setBusy(true)
    const { error: deleteError } = await supabase.from('tournament_posts').delete().eq('id', post.id)
    setBusy(false)
    setConfirmPostId(null)

    if (deleteError) {
      fail(`Could not delete the post: ${deleteError.message}`)
      return
    }

    setPosts((current) => current.filter((row) => row.id !== post.id))
    succeed('Post deleted.')
    await bustCache()
  }

/** Invites, members and sports handlers. */

  /**
   * Save one catalogue entry through the app-admin-only `upsert_sport()` RPC.
   * Updating an existing sport merges vocab through `upsert_sport_vocab()`.
   */
  const saveSport = async (event: FormEvent) => {
    event.preventDefault()
    const code = sportDraft.code.trim().toLowerCase()
    if (!/^[a-z][a-z0-9_]{1,29}$/.test(code)) {
      fail('Sport code must be lowercase letters/digits/underscores (2-30 chars).')
      return
    }
    if (!sportDraft.name.trim()) {
      fail('Give the sport a display name.')
      return
    }

    const parseVocab = (label: string, raw: string): string[] | null => {
      const value = raw.trim()
      if (!value) return null
      try {
        const parsed = JSON.parse(value) as unknown
        if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== 'string')) return null
        return parsed as string[]
      } catch {
        fail(`${label} must be a JSON array of strings.`)
        return null
      }
    }
    const statVocab = parseVocab('Stat vocabulary', sportDraft.stat_vocab)
    if (statVocab === null && sportDraft.stat_vocab.trim()) return
    const eventVocab = parseVocab('Event vocabulary', sportDraft.event_vocab)
    if (eventVocab === null && sportDraft.event_vocab.trim()) return

    setBusy(true)
    const { data, error: rpcError } = await supabase.rpc('upsert_sport', {
      p_code: code,
      p_name: sportDraft.name.trim(),
      p_scoring_type: sportDraft.scoring_type,
      p_stat_vocab: statVocab === null ? null : JSON.parse(JSON.stringify(statVocab)),
      p_event_vocab: eventVocab === null ? null : JSON.parse(JSON.stringify(eventVocab)),
    })
    setBusy(false)

    if (rpcError) {
      fail(`Could not save the sport: ${rpcError.message}`)
      return
    }

    const sportId =
      data && typeof data === 'object' && 'id' in data ? String((data as { id: string }).id) : ''
    if (sportId) {
      const { data: refreshed } = await supabase
        .from('sports')
        .select('id, code, name, scoring_type')
        .order('name')
      setSports((Array.isArray(refreshed) ? refreshed : []) as SportRow[])
    }

    setSportDraft(EMPTY_SPORT_DRAFT)
    succeed('Sport catalogue updated.')
  }

  /** Save one result entry through the duty-checked `upsert_fixture_entry()` RPC. */
  const saveEntry = async (event: FormEvent) => {
    event.preventDefault()

    const position = Number.parseInt(entryDraft.position, 10)
    if (!entryDraft.fixture_id) {
      fail('Choose the fixture the result belongs to.')
      return
    }
    if (!entryDraft.athlete_id) {
      fail('Choose the athlete or team the result belongs to.')
      return
    }
    if (!Number.isFinite(position) || position < 0 || position > 999) {
      fail('Position must be a number between 0 and 999.')
      return
    }

    const rank = entryDraft.rank.trim() ? Number.parseInt(entryDraft.rank, 10) : null
    if (rank !== null && (!Number.isFinite(rank) || rank < 1)) {
      fail('Rank must be a positive number.')
      return
    }

    setBusy(true)
    const { error: rpcError } = await supabase.rpc('upsert_fixture_entry', {
      p_fixture_id: entryDraft.fixture_id,
      p_athlete_id: entryDraft.athlete_id,
      p_team_id: athletes.find((row) => row.id === entryDraft.athlete_id)?.team_id ?? null,
      p_position: position,
      p_lane: entryDraft.lane.trim() ? entryDraft.lane.trim() : null,
      p_result: {},
      p_rank: rank,
      p_medal: entryDraft.medal === 'none' ? null : entryDraft.medal,
    })
    setBusy(false)

    if (rpcError) {
      fail(`Could not save the entry: ${rpcError.message}`)
      return
    }

    const { data: refreshed } = await supabase
      .from('fixture_entries')
      .select('id, fixture_id, athlete_id, team_id, position, lane, rank, medal')
      .eq('fixture_id', entryDraft.fixture_id)
    setEntries((current) => [
      ...current.filter((row) => row.fixture_id !== entryDraft.fixture_id),
      ...((Array.isArray(refreshed) ? refreshed : []) as FixtureEntryRow[]),
    ])
    setEntryDraft(EMPTY_ENTRY_DRAFT)
    succeed('Result entry saved.')
    await bustCache()
  }

  const deleteEntry = async (entry: FixtureEntryRow) => {
    if (confirmEntryId !== entry.id) {
      setConfirmEntryId(entry.id)
      return
    }

    setBusy(true)
    const { error: deleteError } = await supabase
      .from('fixture_entries')
      .delete()
      .eq('id', entry.id)
    setBusy(false)
    setConfirmEntryId(null)

    if (deleteError) {
      fail(`Could not delete the entry: ${deleteError.message}`)
      return
    }

    setEntries((current) => current.filter((row) => row.id !== entry.id))
    succeed('Result entry removed.')
    await bustCache()
  }

    const createInvite = async (event: FormEvent) => {
    event.preventDefault()
    if (!tournament) return

    const days = Number.parseInt(inviteExpiryDays, 10)
    if (Number.isNaN(days) || days < 1 || days > 90) {
      fail('Choose an expiry between 1 and 90 days.')
      return
    }
    const duties = parseInviteDuties(inviteDutyInput)
    if (!duties) {
      fail('Enter at least one valid duty (e.g. `*`, `posts`, `stat:shots`, `event:goal` — separated by commas).')
      return
    }
    setInviteDutyInput(duties.join(' '))

    setBusy(true)
    const { data, error: rpcError } = await supabase.rpc('create_tournament_invite', {
      p_tournament_id: tournament.id,
      p_duties: duties,
      p_expires_at: new Date(Date.now() + days * 86_400_000).toISOString(),
    })
    setBusy(false)

    if (rpcError) {
      fail(`Could not create the invite: ${rpcError.message}`)
      return
    }

    const token =
      data && typeof data === 'object' && 'token' in data ? String((data as { token: string }).token) : ''
    succeed(token ? 'Invite created — copy the link below and share it.' : 'Invite created.')
    setInviteDutyInput('*')

    const { data: refreshed } = await supabase.rpc('list_tournament_invites', {
      p_tournament_id: tournament.id,
    })
    setInvites((Array.isArray(refreshed) ? refreshed : []) as InviteRow[])
  }

  const revokeInvite = async (invite: InviteRow) => {
    if (confirmInviteId !== invite.invite_id) {
      setConfirmInviteId(invite.invite_id)
      return
    }

    setBusy(true)
    const { error: rpcError } = await supabase.rpc('revoke_tournament_invite', {
      p_invite_id: invite.invite_id,
    })
    setBusy(false)
    setConfirmInviteId(null)

    if (rpcError) {
      fail(`Could not revoke the invite: ${rpcError.message}`)
      return
    }

    setInvites((current) =>
      current.map((row) => (row.invite_id === invite.invite_id ? { ...row, revoked: true } : row))
    )
    succeed('Invite revoked.')
  }

  const copyInviteLink = async (token: string) => {
    const link = `${window.location.origin}/invite/${token}`
    try {
      await navigator.clipboard.writeText(link)
      setCopiedToken(token)
      succeed('Invite link copied.')
    } catch {
      fail(`Copy failed — share this link manually: ${link}`)
    }
  }

  const toggleSport = async (sport: SportRow) => {
    if (!tournament) return
    const selected = selectedSportIds.includes(sport.id)

    setBusy(true)
    const { error: writeError } = selected
      ? await supabase
          .from('tournament_sports')
          .delete()
          .eq('tournament_id', tournament.id)
          .eq('sport_id', sport.id)
      : await supabase
          .from('tournament_sports')
          .insert({ tournament_id: tournament.id, sport_id: sport.id })
    setBusy(false)

    if (writeError) {
      fail(`Could not update the sports list: ${writeError.message}`)
      return
    }

    setSelectedSportIds((current) =>
      selected ? current.filter((value) => value !== sport.id) : [...current, sport.id]
    )
    succeed(selected ? `${sport.name} removed.` : `${sport.name} enabled.`)
    await bustCache()
  }

  if (authLoading || loading) {
    return <BrandedLoader message="Loading tournament workspace…" />
  }

  if (!authenticated) {
    return (
      <GatePanel
        title="Sign in required"
        body="This tournament workspace is only available to signed-in tournament staff."
        href={`/login?next=${encodeURIComponent(pathname)}`}
        action="Sign in"
      />
    )
  }

  if (!canAccessAdmin || (!membership && !isAppAdmin)) {
    return (
      <GatePanel
        title="No access to this tournament"
        body="Your account is not an app admin and is not a member of this tournament. Ask a director for an invite link."
        href="/admin"
        action="Back to the dashboard"
      />
    )
  }

  if (missing || !tournament) {
    return (
      <GatePanel
        title="Tournament not found"
        body="This tournament edition no longer exists."
        href="/admin/tournaments"
        action="All tournaments"
      />
    )
  }

  const publishedCount = posts.filter((post) => post.published).length

return (
    <div className="min-h-screen bg-[#0f172a] text-white pb-24">
      <header className="sticky top-0 z-30 border-b border-white/10 bg-[#0f172a]/95 backdrop-blur">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-4">
            <Link href="/admin/tournaments" className="text-sm text-gray-400 hover:text-white">
              ← All tournaments
            </Link>
            <div>
              <h1 className="text-lg font-bold">{tournament.name}</h1>
              <p className="text-xs text-gray-400">
                {tournament.edition || 'No edition label'} &bull; {formatDate(tournament.start_date)}{' '}
                → {formatDate(tournament.end_date)}
                {tournament.is_active ? ' • active' : ''}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <Link href="/competitions" className="text-indigo-400 hover:text-indigo-300">
              Public hub
            </Link>
            <span className="rounded-full bg-white/10 px-3 py-1 text-xs uppercase tracking-wide text-gray-300">
              {isAppAdmin ? 'App admin' : formatDuties(membership?.duties)}
            </span>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-8 space-y-8">
        {error && (
          <p
            role="status"
            className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300"
          >
            {error}
          </p>
        )}
        {notice && (
          <p
            role="status"
            className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300"
          >
            {notice}
          </p>
        )}

        {!isAppAdmin && (
          <p className="rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-xs text-gray-300">
            Editing as a tournament member ({formatDuties(membership?.duties)}). Overview fields and
            the sports picker are app-admin only — your scope is enforced by RLS.
          </p>
        )}

        <Section
          title="Overview"
          tour="workspace-header"
          description="Name, slug, venue and dates shown across the public site."
        >
          <form onSubmit={saveOverview} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Name">
              <input
                className={INPUT}
                value={overviewDraft.name}
                disabled={busy || !isAppAdmin}
                onChange={(event) => setOverviewDraft({ ...overviewDraft, name: event.target.value })}
              />
            </Field>
            <Field label="Slug">
              <input
                className={INPUT}
                value={overviewDraft.slug}
                disabled={busy || !isAppAdmin}
                onChange={(event) =>
                  setOverviewDraft({ ...overviewDraft, slug: slugify(event.target.value) })
                }
              />
            </Field>
            <Field label="Edition">
              <input
                className={INPUT}
                value={overviewDraft.edition}
                disabled={busy || !isAppAdmin}
                onChange={(event) =>
                  setOverviewDraft({ ...overviewDraft, edition: event.target.value })
                }
              />
            </Field>
            <Field label="Host city">
              <input
                className={INPUT}
                value={overviewDraft.venue_city}
                disabled={busy || !isAppAdmin}
                onChange={(event) =>
                  setOverviewDraft({ ...overviewDraft, venue_city: event.target.value })
                }
              />
            </Field>
            <Field label="Start date">
              <input
                type="date"
                className={INPUT}
                value={overviewDraft.start_date}
                disabled={busy || !isAppAdmin}
                onChange={(event) =>
                  setOverviewDraft({ ...overviewDraft, start_date: event.target.value })
                }
              />
            </Field>
            <Field label="End date">
              <input
                type="date"
                className={INPUT}
                value={overviewDraft.end_date}
                disabled={busy || !isAppAdmin}
                onChange={(event) =>
                  setOverviewDraft({ ...overviewDraft, end_date: event.target.value })
                }
              />
            </Field>
            <Field label="Status">
              <select
                className={INPUT}
                value={overviewDraft.status}
                disabled={busy || !isAppAdmin}
                onChange={(event) =>
                  setOverviewDraft({
                    ...overviewDraft,
                    status: event.target.value as TournamentStatus,
                  })
                }
              >
                {STATUS_OPTIONS.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </Field>
            <div className="flex items-end">
              <button type="submit" className={PRIMARY} disabled={busy || !isAppAdmin}>
                Save overview
              </button>
            </div>
          </form>
        </Section>

<Section
          title="Competition settings"
          description="Format, table arrangement and the rules block shown to the public."
        >
          <form onSubmit={saveSettings} className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Field label="Format">
                <select
                  className={INPUT}
                  value={settingsDraft.format}
                  disabled={busy}
                  onChange={(event) =>
                    setSettingsDraft({
                      ...settingsDraft,
                      format: event.target.value as SettingsFormat,
                    })
                  }
                >
                  {FORMAT_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            <Field label="Table arrangement">
              <textarea
                className={`${INPUT} min-h-[90px]`}
                value={settingsDraft.table_arrangement}
                disabled={busy}
                onChange={(event) =>
                  setSettingsDraft({ ...settingsDraft, table_arrangement: event.target.value })
                }
              />
            </Field>

            <Field label="Rules and code of conduct">
              <textarea
                className={`${INPUT} min-h-[140px]`}
                value={settingsDraft.rules}
                disabled={busy}
                onChange={(event) =>
                  setSettingsDraft({ ...settingsDraft, rules: event.target.value })
                }
              />
            </Field>

            <button type="submit" className={PRIMARY} disabled={busy}>
              Save settings
            </button>
          </form>
        </Section>

        <Section
          title={`News & articles (${posts.length}, ${publishedCount} published)`}
          description="Written by tournament staff, published instantly to the home carousel and /news."
          aside={
            canWritePosts ? (
              <span className="text-xs text-gray-400">Duty: news &amp; posts</span>
            ) : (
              <span className="text-xs text-amber-300">
                Read-only — your duties do not include posts
              </span>
            )
          }
        >
          {posts.length === 0 ? (
            <p className="text-sm text-gray-500">No articles yet for this tournament.</p>
          ) : (
            <ul className="divide-y divide-white/5">
              {posts.map((post) => (
                <li key={post.id} className="py-4">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                      <p className="font-medium">
                        {post.title}{' '}
                        {post.published ? (
                          <span className="ml-2 rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs text-emerald-300">
                            published
                          </span>
                        ) : (
                          <span className="ml-2 rounded-full bg-white/10 px-2 py-0.5 text-xs text-gray-300">
                            draft
                          </span>
                        )}
                      </p>
                      <p className="mt-1 text-xs text-gray-400">
                        /news/{post.slug} &bull; {post.category || 'News'} &bull;{' '}
                        {post.published_at ? formatDateTime(post.published_at) : 'never published'}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {post.published && (
                        <Link href={`/news/${post.slug}`} className={SUBTLE}>
                          View
                        </Link>
                      )}
                      <button
                        type="button"
                        className={SUBTLE}
                        disabled={busy || !canWritePosts}
                        onClick={() => void togglePostPublished(post)}
                      >
                        {post.published ? 'Unpublish' : 'Publish'}
                      </button>
                      <button
                        type="button"
                        className={SUBTLE}
                        disabled={busy || !canWritePosts}
                        onClick={() => beginPostEdit(post)}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className={confirmPostId === post.id ? DANGER : SUBTLE}
                        disabled={busy || !canWritePosts}
                        onClick={() => void deletePost(post)}
                      >
                        {confirmPostId === post.id ? 'Confirm delete' : 'Delete'}
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {canWritePosts && (
            <form onSubmit={savePost} className="mt-6 space-y-4 border-t border-white/10 pt-6">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-indigo-300">
                {editingPostId ? 'Edit article' : 'New article'}
              </h3>

              <PostFormFields
                draft={postDraft}
                onChange={(patch) => setPostDraft((current) => ({ ...current, ...patch }))}
                disabled={busy}
                slugEdited={slugEdited}
                onSlugEdited={() => setSlugEdited(true)}
              />

              <div className="flex flex-wrap gap-2">
                <button type="submit" className={PRIMARY} disabled={busy}>
                  {editingPostId ? 'Save article' : 'Create article'}
                </button>
                {editingPostId && (
                  <button type="button" className={SECONDARY} disabled={busy} onClick={resetPostForm}>
                    Cancel edit
                  </button>
                )}
              </div>
            </form>
          )}
        </Section>

<Section
          title={`Invites (${invites.length})`}
          tour="workspace-invites"
          description="Unlimited-use links. Anyone who signs in and opens a link joins this tournament with the chosen duty."
          aside={
            <span className="text-xs text-gray-400">
              {canManageInvites ? 'You can create and revoke' : 'Read-only'}
            </span>
          }
        >
          {canManageInvites && (
            <form onSubmit={createInvite} className="flex flex-wrap items-end gap-3">
              <Field label="Duty (comma-separated)">
                <input
                  type="text"
                  className={INPUT}
                  value={inviteDutyInput}
                  disabled={busy}
                  placeholder="* / score / stat:shots,event:goal"
                  onChange={(event) => setInviteDutyInput(event.target.value)}
                />
                <div className="mt-1 flex flex-wrap gap-1">
                  {DUTY_PRESETS.map((preset) => (
                    <button
                      key={preset.value}
                      type="button"
                      className="text-xs underline decoration-gray-500 hover:decoration-gray-400"
                      disabled={busy}
                      onClick={() => {
                        setInviteDutyInput(preset.value)
                      }}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </Field>
              <Field label="Expires in (days)">
                <input
                  type="number"
                  min={1}
                  max={90}
                  className={INPUT}
                  value={inviteExpiryDays}
                  disabled={busy}
                  onChange={(event) => setInviteExpiryDays(event.target.value)}
                />
              </Field>
              <button type="submit" className={PRIMARY} disabled={busy}>
                Create invite
              </button>
            </form>
          )}

          {invites.length === 0 ? (
            <p className="mt-4 text-sm text-gray-500">No invites created yet.</p>
          ) : (
            <ul className="mt-5 divide-y divide-white/5">
              {invites.map((invite) => {
                const expired = isExpired(invite.expires_at)
                const dead = invite.revoked || expired
                return (
                  <li key={invite.invite_id} className="py-3">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className="font-mono text-xs break-all text-gray-300">
                          /invite/{invite.token}
                        </p>
                        <p className="mt-1 text-xs text-gray-400">
                          {formatDuties(invite.duties)} &bull;{' '}
                          {invite.revoked
                            ? 'revoked'
                            : expired
                              ? 'expired'
                              : `expires ${formatDateTime(invite.expires_at)}`}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          className={SUBTLE}
                          disabled={dead}
                          onClick={() => void copyInviteLink(invite.token)}
                        >
                          {copiedToken === invite.token ? 'Copied' : 'Copy link'}
                        </button>
                        <button
                          type="button"
                          className={confirmInviteId === invite.invite_id ? DANGER : SUBTLE}
                          disabled={busy || invite.revoked || !canManageInvites}
                          onClick={() => void revokeInvite(invite)}
                        >
                          {confirmInviteId === invite.invite_id ? 'Confirm revoke' : 'Revoke'}
                        </button>
                      </div>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </Section>

<Section
          title={`Members (${members.length})`}
          tour="workspace-members"
          description="Everyone with scoped access to this tournament."
        >
          {members.length === 0 ? (
            <p className="text-sm text-gray-500">No members yet — create an invite above.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs uppercase tracking-wide text-gray-400">
                  <tr>
                    <th className="px-3 py-2">Email</th>
                    <th className="px-3 py-2">Duties</th>
                    <th className="px-3 py-2">Granted</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {members.map((member) => (
                    <tr key={member.membership_id}>
                      <td className="px-3 py-3 text-gray-200">{member.email ?? 'Unknown email'}</td>
                      <td className="px-3 py-3 text-gray-300">{formatDuties(member.duties)}</td>
                      <td className="px-3 py-3 text-gray-400">{formatDateTime(member.granted_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>

        {isAppAdmin && (
          <Section
            title={`Sports (${selectedSportIds.length} enabled)`}
            tour="workspace-sports"
            description="Enable sports for this edition, and edit the shared catalogue: scoring type, live clock and the stat/event vocabulary the console offers. App admins only."
          >
            <div className="flex flex-wrap gap-2">
              {sports.map((sport) => {
                const enabled = selectedSportIds.includes(sport.id)
                return (
                  <button
                    key={sport.id}
                    type="button"
                    disabled={busy}
                    onClick={() => void toggleSport(sport)}
                    className={
                      'rounded-full border px-4 py-2 text-sm transition-colors ' +
                      (enabled
                        ? 'border-indigo-500/60 bg-indigo-600/20 text-white'
                        : 'border-white/10 text-gray-300 hover:bg-white/5')
                    }
                  >
                    {sport.name}
                  </button>
                )
              })}
              {sports.length === 0 && (
                <p className="text-sm text-gray-500">
                  No sports in the catalogue yet — run the sports-catalog migration.
                </p>
              )}
            </div>

            {/* Catalogue editor — upsert_sport / upsert_sport_vocab (app-admin only RPCs). */}
            <form onSubmit={saveSport} className="mt-6 grid gap-3 border-t border-white/10 pt-5 sm:grid-cols-2">
              <p className="sm:col-span-2 text-xs uppercase tracking-widest text-indigo-300">
                Catalogue editor — creates or updates one sport
              </p>
              <Field label="Sport">
                <select
                  className={INPUT}
                  value={sportDraft.code}
                  disabled={busy}
                  onChange={(event) => {
                    const code = event.target.value
                    const existing = sports.find((row) => row.code === code)
                    setSportDraft({ ...sportDraft, code, name: existing ? sportDraft.name : '' })
                  }}
                >
                  <option value="">New sport…</option>
                  {sports.map((sport) => (
                    <option key={sport.id} value={sport.code}>
                      {sport.name} ({sport.code})
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Display name">
                <input
                  className={INPUT}
                  value={sportDraft.name}
                  disabled={busy}
                  placeholder="e.g. Handball"
                  onChange={(event) => setSportDraft({ ...sportDraft, name: event.target.value })}
                />
              </Field>
              <Field label="Scoring type">
                <select
                  className={INPUT}
                  value={sportDraft.scoring_type}
                  disabled={busy}
                  onChange={(event) => setSportDraft({ ...sportDraft, scoring_type: event.target.value })}
                >
                  {SCORING_TYPES.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Stat vocabulary (JSON)">
                <input
                  className={INPUT}
                  value={sportDraft.stat_vocab}
                  disabled={busy}
                  placeholder='["goals","shots"]'
                  onChange={(event) => setSportDraft({ ...sportDraft, stat_vocab: event.target.value })}
                />
              </Field>
              <Field label="Event vocabulary (JSON)">
                <input
                  className={INPUT}
                  value={sportDraft.event_vocab}
                  disabled={busy}
                  placeholder='["goal","yellow_card"]'
                  onChange={(event) => setSportDraft({ ...sportDraft, event_vocab: event.target.value })}
                />
              </Field>
              <div className="flex items-end sm:col-span-2">
                <button type="submit" className={PRIMARY} disabled={busy}>
                  Save sport
                </button>
              </div>
            </form>
          </Section>
        )}

        <Section
          title={`Athletes (${athletes.length})`}
          description="Individual-sport competitors registered for this tournament. Writes are duty-checked via the database."
          aside={
            <span className="text-xs text-gray-400">
              {isAppAdmin || hasDuty(membership?.duties, '*') ? 'Can manage' : 'Read-only'}
            </span>
          }
        >
          {(isAppAdmin || hasDuty(membership?.duties, '*')) ? (
            <TournamentAthletesManager
              tournamentId={id}
              athletes={athletes}
              onChanged={loadAll}
            />
          ) : (
            <p className="text-sm text-gray-500">Your duties do not include athlete management.</p>
          )}
        </Section>

        <Section
          title={`Results & Entries (${entries.length})`}
          tour="workspace-entries"
          description="Rank and medal entries for individual-sport fixtures. Toggled by duty: '*' or 'score'."
          aside={
            <span className="text-xs text-gray-400">
              {isAppAdmin || hasDuty(membership?.duties, '*') || hasDuty(membership?.duties, 'score') ? 'Can manage' : 'Read-only'}
            </span>
          }
        >
          {(isAppAdmin || hasDuty(membership?.duties, '*') || hasDuty(membership?.duties, 'score')) ? (
            <>
              <form onSubmit={saveEntry} className="mb-6 grid gap-3 sm:grid-cols-3">
                <Field label="Fixture">
                  <select
                    className={INPUT}
                    value={entryDraft.fixture_id}
                    disabled={busy}
                    onChange={(event) => setEntryDraft({ ...entryDraft, fixture_id: event.target.value })}
                  >
                    <option value="">Choose a fixture…</option>
                    {fixtures.map((fixture) => {
                      const when = fixture.match_date
                        ? new Date(fixture.match_date).toLocaleDateString()
                        : 'unscheduled'
                      const label = `${fixture.home_team?.short_name ?? '?'} v ${fixture.away_team?.short_name ?? '?'} · ${when}`
                      return (
                        <option key={fixture.id} value={fixture.id}>
                          {label}
                        </option>
                      )
                    })}
                  </select>
                </Field>
                <Field label="Competitor">
                  <select
                    className={INPUT}
                    value={entryDraft.athlete_id}
                    disabled={busy}
                    onChange={(event) => setEntryDraft({ ...entryDraft, athlete_id: event.target.value })}
                  >
                    <option value="">Choose an athlete…</option>
                    {athletes.map((athlete) => (
                      <option key={athlete.id} value={athlete.id}>
                        {athlete.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Position">
                  <input
                    type="number"
                    min={0}
                    max={999}
                    className={INPUT}
                    value={entryDraft.position}
                    disabled={busy}
                    placeholder="1"
                    onChange={(event) => setEntryDraft({ ...entryDraft, position: event.target.value })}
                  />
                </Field>
                <Field label="Lane (optional)">
                  <input
                    className={INPUT}
                    value={entryDraft.lane}
                    disabled={busy}
                    placeholder="Lane 3 / Heat B"
                    onChange={(event) => setEntryDraft({ ...entryDraft, lane: event.target.value })}
                  />
                </Field>
                <Field label="Rank (optional)">
                  <input
                    type="number"
                    min={1}
                    className={INPUT}
                    value={entryDraft.rank}
                    disabled={busy}
                    placeholder="1 = first"
                    onChange={(event) => setEntryDraft({ ...entryDraft, rank: event.target.value })}
                  />
                </Field>
                <Field label="Medal">
                  <select
                    className={INPUT}
                    value={entryDraft.medal}
                    disabled={busy}
                    onChange={(event) => setEntryDraft({ ...entryDraft, medal: event.target.value })}
                  >
                    {MEDAL_OPTIONS.map((option) => (
                      <option key={option} value={option}>
                        {option === 'none' ? 'No medal' : option}
                      </option>
                    ))}
                  </select>
                </Field>
                <div className="flex items-end sm:col-span-3">
                  <button type="submit" className={PRIMARY} disabled={busy}>
                    Save entry
                  </button>
                </div>
              </form>

              {entries.length === 0 ? (
                <p className="text-sm text-gray-500">No result entries recorded yet.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="text-xs uppercase tracking-wide text-gray-400 bg-black/20">
                      <tr>
                        <th className="px-3 py-2">Fixture</th>
                        <th className="px-3 py-2">Competitor</th>
                        <th className="px-3 py-2 text-right">Pos</th>
                        <th className="px-3 py-2 text-right">Rank</th>
                        <th className="px-3 py-2 text-center">Medal</th>
                        <th className="px-3 py-2" aria-label="Actions" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {entries.map((entry) => {
                        const athlete = athletes.find((a) => a.id === entry.athlete_id)
                        const fixture = fixtures.find((f) => f.id === entry.fixture_id)
                        const fixtureLabel = fixture
                          ? `${fixture.home_team?.short_name ?? '?'} v ${fixture.away_team?.short_name ?? '?'}`
                          : entry.fixture_id.slice(0, 8) + '…'
                        const confirmDelete = confirmEntryId === entry.id
                        return (
                          <tr key={entry.id} className="hover:bg-white/5">
                            <td className="px-3 py-2 font-mono text-xs text-gray-400" title={entry.fixture_id}>
                              {fixtureLabel}
                            </td>
                            <td className="px-3 py-2 text-white">{athlete?.name ?? <span className="text-gray-500">—</span>}</td>
                            <td className="px-3 py-2 text-right tabular-nums text-gray-300">{entry.position}</td>
                            <td className="px-3 py-2 text-right tabular-nums text-gray-300">{entry.rank ?? '—'}</td>
                            <td className="px-3 py-2 text-center">
                              {entry.medal ? (
                                <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${
                                  entry.medal === 'gold' ? 'bg-yellow-500/20 text-yellow-300'
                                  : entry.medal === 'silver' ? 'bg-gray-400/20 text-gray-200'
                                  : 'bg-amber-700/20 text-amber-300'
                                }`}>
                                  {entry.medal}
                                </span>
                              ) : (
                                <span className="text-gray-600">—</span>
                              )}
                            </td>
                            <td className="px-3 py-2 text-right">
                              <button
                                type="button"
                                onClick={() => void deleteEntry(entry)}
                                disabled={busy}
                                className={
                                  'rounded-md px-2 py-1 text-xs font-semibold ' +
                                  (confirmDelete
                                    ? 'bg-red-500/80 text-white'
                                    : 'text-gray-400 hover:text-white hover:bg-white/5')
                                }
                              >
                                {confirmDelete ? 'Confirm' : 'Delete'}
                              </button>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          ) : (
            <p className="text-sm text-gray-500">Your duties do not include results management.</p>
          )}
        </Section>
      </div>
    </div>
  )
}