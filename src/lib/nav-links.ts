/**
 * The single source of truth for the top navigation.
 *
 * Extracted from `Navigation.tsx` so the onboarding guide, its contract test and
 * the nav itself can never drift apart: the guide asserts that every link here
 * is documented for at least one role, and the nav renders exactly this list.
 */

export interface NavLink {
  href: string
  label: string
  /** `data-tour` anchor the guided tour highlights, when one exists. */
  tour?: string
}

/** Links every visitor sees (fans, users, staff). */
export const PUBLIC_LINKS: readonly NavLink[] = [
  { href: '/', label: 'Home', tour: 'nav-public' },
  { href: '/teams', label: 'Teams', tour: 'teams-explorer' },
  { href: '/competitions', label: 'Competitions', tour: 'competitions-tabs' },
  { href: '/news', label: 'News', tour: 'news-list' },
  { href: '/medals', label: 'Medals', tour: 'medals-table' },
  { href: '/onboarding', label: 'Guide', tour: 'guide-tabs' },
] as const

/** Links only staff see; `Users` is filtered to app admins at render time. */
export const ADMIN_LINKS: readonly NavLink[] = [
  { href: '/admin', label: 'Dashboard' },
  { href: '/admin/tournaments', label: 'Tournaments' },
  { href: '/admin/posts', label: 'Posts' },
  { href: '/admin/users', label: 'Users' },
] as const

/** Route the tour starts from when a role's own route is unreachable. */
export const DEFAULT_TOUR_ROUTE = '/'
