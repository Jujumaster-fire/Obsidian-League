'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { createClient } from '@/utils/supabase/client'
import { useAdminAuth } from '@/lib/use-admin-auth'
import { BrandedLoader } from '@/components/Skeleton'
import {
  AccessPanel,
  Field,
  SelectInput,
  StatusBanner,
  TextInput,
  adminInputClass,
  adminPrimaryButton,
  adminSubtleButton,
} from '@/components/admin/AdminWidgets'

/**
 * /admin/posts — the newsroom.
 *
 * These articles are the "Latest Insights" cards on the home page and the
 * /news feed: staff write short updates during a tournament (scores, schedule
 * changes, spotlights) and publish them instantly. Drafts stay invisible to the
 * public because RLS only exposes rows where `published` is true.
 *
 * Scope is derived from `useAdminAuth()`: app admins see every tournament,
 * members only the ones whose duties include `'*'` or `'posts'`.
 */

const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/

interface TournamentOption {
  id: string
  name: string
  slug: string
  is_active: boolean
}

interface PostRow {
  id: string
  tournament_id: string
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
  tournament_id: string
  title: string
  slug: string
  excerpt: string
  body: string
  image_url: string
  category: string
  published: boolean
}

const EMPTY_DRAFT: PostDraft = {
  tournament_id: '',
  title: '',
  slug: '',
  excerpt: '',
  body: '',
  image_url: '',
  category: 'News',
  published: false,
}

const slugify = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

const orNull = (value: string) => {
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

const formatDateTime = (value: string | null | undefined) => {
  if (!value) return 'Never published'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

export default function AdminPostsPage() {
  const supabase = useMemo(() => createClient(), [])
  const { loading: authLoading, authenticated, canAccessAdmin, isAppAdmin, memberships } =
    useAdminAuth()

  const [loading, setLoading] = useState(true)
  const [tournaments, setTournaments] = useState<TournamentOption[]>([])
  const [posts, setPosts] = useState<PostRow[]>([])
  const [tournamentFilter, setTournamentFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [draft, setDraft] = useState<PostDraft>(EMPTY_DRAFT)
  const [slugEdited, setSlugEdited] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<{ kind: 'success' | 'error'; message: string } | null>(null)

  const notify = (kind: 'success' | 'error', message: string) => setStatus({ kind, message })

  /** Tournaments this user may publish into. */
  const writableTournamentIds = useMemo(
    () =>
      memberships
        .filter((membership) => membership.duties.includes('*') || membership.duties.includes('posts'))
        .map((membership) => membership.tournament_id),
    [memberships]
  )

const loadTournaments = useCallback(async () => {
    if (isAppAdmin) {
      const { data } = await supabase
        .from('tournaments')
        .select('id, name, slug, is_active')
        .order('is_active', { ascending: false })
        .order('name')
      setTournaments((Array.isArray(data) ? data : []) as TournamentOption[])
      return
    }

    if (writableTournamentIds.length === 0) {
      setTournaments([])
      return
    }

    const { data } = await supabase
      .from('tournaments')
      .select('id, name, slug, is_active')
      .in('id', writableTournamentIds)
      .order('name')
    setTournaments((Array.isArray(data) ? data : []) as TournamentOption[])
  }, [isAppAdmin, supabase, writableTournamentIds])

  const loadPosts = useCallback(async () => {
    setLoading(true)

    let query = supabase
      .from('tournament_posts')
      .select(
        'id, tournament_id, title, slug, excerpt, body, image_url, category, published, published_at, created_at'
      )
      .order('created_at', { ascending: false })
      .limit(200)

    if (tournamentFilter !== 'all') {
      query = query.eq('tournament_id', tournamentFilter)
    } else if (!isAppAdmin) {
      if (writableTournamentIds.length === 0) {
        setPosts([])
        setLoading(false)
        return
      }
      query = query.in('tournament_id', writableTournamentIds)
    }

    const { data, error } = await query
    if (error) {
      notify('error', `Could not load posts: ${error.message}`)
      setPosts([])
    } else {
      setPosts((Array.isArray(data) ? data : []) as PostRow[])
    }

    setLoading(false)
  }, [isAppAdmin, supabase, tournamentFilter, writableTournamentIds])

  useEffect(() => {
    if (authLoading || !canAccessAdmin) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data-loading effect: fetch then set state once
    void loadTournaments()
  }, [authLoading, canAccessAdmin, loadTournaments])

  useEffect(() => {
    if (authLoading || !canAccessAdmin) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data-loading effect: fetch then set state once
    void loadPosts()
  }, [authLoading, canAccessAdmin, loadPosts])

  useEffect(() => {
    if (draft.tournament_id || tournaments.length === 0) return
    const preferred = tournaments.find((row) => row.is_active) ?? tournaments[0]
    // eslint-disable-next-line react-hooks/set-state-in-effect -- seeds the composer once from the loaded tournament list
    setDraft((current) => ({ ...current, tournament_id: preferred.id }))
  }, [draft.tournament_id, tournaments])

  const bustCache = async () => {
    try {
      await fetch('/api/revalidate', { method: 'POST' })
    } catch {
      // best effort — the ISR window still converges
    }
  }

  const resetForm = () => {
    setEditingId(null)
    setSlugEdited(false)
    setDraft({ ...EMPTY_DRAFT, tournament_id: draft.tournament_id })
  }

  const beginEdit = (post: PostRow) => {
    setConfirmId(null)
    setEditingId(post.id)
    setSlugEdited(true)
    setDraft({
      tournament_id: post.tournament_id,
      title: post.title ?? '',
      slug: post.slug ?? '',
      excerpt: post.excerpt ?? '',
      body: post.body ?? '',
      image_url: post.image_url ?? '',
      category: post.category ?? 'News',
      published: Boolean(post.published),
    })
  }

  const save = async (event: React.FormEvent) => {
    event.preventDefault()

    const title = draft.title.trim()
    const slug = slugify(draft.slug || title)

    if (!draft.tournament_id) {
      notify('error', 'Choose the tournament this article belongs to.')
      return
    }
    if (!title) {
      notify('error', 'Give the article a title.')
      return
    }
    if (!SLUG_PATTERN.test(slug)) {
      notify('error', 'The slug may only contain lowercase letters, numbers and single dashes.')
      return
    }

    setBusy(true)
    const payload = {
      tournament_id: draft.tournament_id,
      title,
      slug,
      excerpt: orNull(draft.excerpt),
      body: orNull(draft.body),
      image_url: orNull(draft.image_url),
      category: draft.category.trim() || 'News',
      published: draft.published,
      published_at: draft.published ? new Date().toISOString() : null,
    }

    const { error } = editingId
      ? await supabase.from('tournament_posts').update(payload).eq('id', editingId)
      : await supabase.from('tournament_posts').insert(payload)
    setBusy(false)

    if (error) {
      notify('error', `Could not save the article: ${error.message}`)
      return
    }

    notify('success', editingId ? 'Article updated.' : 'Article created.')
    resetForm()
    await bustCache()
    await loadPosts()
  }

  const togglePublished = async (post: PostRow) => {
    const next = !post.published
    setBusy(true)
    const { error } = await supabase
      .from('tournament_posts')
      .update({
        published: next,
        published_at: next ? post.published_at ?? new Date().toISOString() : post.published_at,
      })
      .eq('id', post.id)
    setBusy(false)

    if (error) {
      notify('error', `Could not change the status: ${error.message}`)
      return
    }

    setPosts((current) =>
      current.map((row) => (row.id === post.id ? { ...row, published: next } : row))
    )
    notify('success', next ? 'Article published.' : 'Article unpublished.')
    await bustCache()
  }

  const remove = async (post: PostRow) => {
    if (confirmId !== post.id) {
      setConfirmId(post.id)
      return
    }

    setBusy(true)
    const { error } = await supabase.from('tournament_posts').delete().eq('id', post.id)
    setBusy(false)
    setConfirmId(null)

    if (error) {
      notify('error', `Could not delete the article: ${error.message}`)
      return
    }

    setPosts((current) => current.filter((row) => row.id !== post.id))
    notify('success', 'Article deleted.')
    await bustCache()
  }

const visiblePosts = posts.filter((post) => {
    if (statusFilter === 'published' && !post.published) return false
    if (statusFilter === 'drafts' && post.published) return false
    if (search.trim()) {
      const needle = search.trim().toLowerCase()
      return (
        post.title.toLowerCase().includes(needle) ||
        post.slug.toLowerCase().includes(needle) ||
        (post.category ?? '').toLowerCase().includes(needle)
      )
    }
    return true
  })

  const tournamentName = (tournamentId: string) =>
    tournaments.find((row) => row.id === tournamentId)?.name ?? 'Unknown tournament'

  if (authLoading) return <BrandedLoader message="Checking your access…" />

  if (!authenticated) {
    return (
      <AccessPanel
        title="Sign in required"
        body="The newsroom is only available to signed-in tournament staff."
        href="/login?next=%2Fadmin%2Fposts"
        linkLabel="Sign in"
      />
    )
  }

  if (!canAccessAdmin) {
    return (
      <AccessPanel
        title="No admin access"
        body="Your account is not an app admin and is not a member of any tournament."
        href="/"
        linkLabel="Back to the site"
      />
    )
  }

  const canWrite = isAppAdmin || writableTournamentIds.length > 0

  return (
    <div className="min-h-screen bg-[#0f172a] pb-24 text-white">
      <header className="sticky top-0 z-30 border-b border-white/10 bg-[#0f172a]/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-4 sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:px-8">
          <div>
            <h1 className="text-xl font-bold">Newsroom</h1>
            <p className="text-xs text-gray-400">
              Articles feed the home-page carousel and the public /news page.
            </p>
          </div>
          <nav className="flex flex-wrap items-center gap-4 text-sm">
            <Link href="/admin" className="text-indigo-400 hover:text-indigo-300">
              Dashboard
            </Link>
            <Link href="/admin/tournaments" className="text-indigo-400 hover:text-indigo-300">
              Tournaments
            </Link>
            <Link href="/news" className="text-gray-300 hover:text-white">
              Public news
            </Link>
          </nav>
        </div>
      </header>

      <div className="mx-auto max-w-7xl space-y-8 px-4 pt-8 sm:px-6 lg:px-8">
        <StatusBanner status={status} />

        {!isAppAdmin && (
          <p className="rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-xs text-gray-300">
            You can write for:{' '}
            {tournaments.length > 0
              ? tournaments.map((row) => row.name).join(', ')
              : 'no tournament yet — ask a director for an invite with the “News & posts” duty.'}
          </p>
        )}

        <section data-tour="newsroom-filters" className="rounded-xl border border-white/5 bg-[#1e293b] p-6">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <Field label="Tournament">
              <SelectInput
                value={tournamentFilter}
                onValueChange={setTournamentFilter}
                options={[
                  { value: 'all', label: 'All my tournaments' },
                  ...tournaments.map((row) => ({
                    value: row.id,
                    label: `${row.name}${row.is_active ? ' (active)' : ''}`,
                  })),
                ]}
              />
            </Field>
            <Field label="Status">
              <SelectInput
                value={statusFilter}
                onValueChange={setStatusFilter}
                options={[
                  { value: 'all', label: 'All' },
                  { value: 'published', label: 'Published' },
                  { value: 'drafts', label: 'Drafts' },
                ]}
              />
            </Field>
            <Field label="Search">
              <TextInput
                value={search}
                onValueChange={setSearch}
                placeholder="Title, slug or category"
              />
            </Field>
          </div>
        </section>

<section className="rounded-xl border border-white/5 bg-[#1e293b] p-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Articles ({visiblePosts.length})</h2>
            <span className="text-xs text-gray-400">{loading ? 'Refreshing…' : 'Up to date'}</span>
          </div>

          {visiblePosts.length === 0 ? (
            <p className="text-sm text-gray-500">
              No articles match these filters yet. Write the first update below.
            </p>
          ) : (
            <ul className="divide-y divide-white/5">
              {visiblePosts.map((post) => (
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
                        {tournamentName(post.tournament_id)} &bull; {post.category || 'News'} &bull;{' '}
                        {formatDateTime(post.published_at)} &bull; /news/{post.slug}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {post.published && (
                        <Link href={`/news/${post.slug}`} className={adminSubtleButton}>
                          View
                        </Link>
                      )}
                      <button
                        type="button"
                        className={adminSubtleButton}
                        disabled={busy}
                        onClick={() => void togglePublished(post)}
                      >
                        {post.published ? 'Unpublish' : 'Publish'}
                      </button>
                      <button
                        type="button"
                        className={adminSubtleButton}
                        disabled={busy}
                        onClick={() => beginEdit(post)}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void remove(post)}
                        className={
                          confirmId === post.id
                            ? 'rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white'
                            : adminSubtleButton
                        }
                      >
                        {confirmId === post.id ? 'Confirm delete' : 'Delete'}
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {canWrite ? (
          <section className="rounded-xl border border-white/5 bg-[#1e293b] p-6">
            <h2 className="mb-4 text-lg font-semibold">
              {editingId ? 'Edit article' : 'Write a new article'}
            </h2>

            <form onSubmit={save} className="space-y-4">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <Field label="Tournament">
                  <SelectInput
                    value={draft.tournament_id}
                    onValueChange={(value) => setDraft({ ...draft, tournament_id: value })}
                    options={tournaments.map((row) => ({
                      value: row.id,
                      label: `${row.name}${row.is_active ? ' (active)' : ''}`,
                    }))}
                  />
                </Field>
                <Field label="Category">
                  <TextInput
                    value={draft.category}
                    onValueChange={(value) => setDraft({ ...draft, category: value })}
                    placeholder="News / Match report / Spotlight"
                  />
                </Field>
                <Field label="Title">
                  <TextInput
                    required
                    value={draft.title}
                    onValueChange={(value) =>
                      setDraft({
                        ...draft,
                        title: value,
                        ...(slugEdited ? {} : { slug: slugify(value) }),
                      })
                    }
                  />
                </Field>
                <Field label="Slug">
                  <TextInput
                    value={draft.slug}
                    onValueChange={(value) => {
                      setSlugEdited(true)
                      setDraft({ ...draft, slug: slugify(value) })
                    }}
                  />
                </Field>
                <Field label="Image URL (optional)">
                  <TextInput
                    value={draft.image_url}
                    onValueChange={(value) => setDraft({ ...draft, image_url: value })}
                    placeholder="https://…"
                  />
                </Field>
                <Field label="Excerpt (carousel blurb)">
                  <textarea
                    rows={2}
                    className={adminInputClass}
                    value={draft.excerpt}
                    onChange={(event) => setDraft({ ...draft, excerpt: event.target.value })}
                  />
                </Field>
                <div className="md:col-span-2">
                  <Field label="Body">
                    <textarea
                      rows={8}
                      className={adminInputClass}
                      placeholder="Separate paragraphs with a blank line."
                      value={draft.body}
                      onChange={(event) => setDraft({ ...draft, body: event.target.value })}
                    />
                  </Field>
                </div>
              </div>

              <label className="flex items-center gap-3 text-sm text-gray-300">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-white/20 bg-[#0f172a]"
                  checked={draft.published}
                  onChange={(event) => setDraft({ ...draft, published: event.target.checked })}
                />
                Publish immediately (visible on the home carousel and /news)
              </label>

              <div className="flex flex-wrap gap-3">
                <button type="submit" disabled={busy} className={adminPrimaryButton}>
                  {busy ? 'Saving…' : editingId ? 'Save article' : 'Create article'}
                </button>
                {editingId && (
                  <button type="button" onClick={resetForm} className={adminSubtleButton}>
                    Cancel edit
                  </button>
                )}
              </div>
            </form>
          </section>
        ) : (
          <p className="rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-sm text-gray-300">
            You have read-only access to these articles. Ask a director for an invite whose duty is
            “News &amp; posts” to publish updates.
          </p>
        )}
      </div>
    </div>
  )
}