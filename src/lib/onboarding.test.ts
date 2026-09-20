import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { dutyLabel, RESERVED_DUTIES } from '@/lib/duties'
import {
  DUTY_DOCS,
  FEATURES,
  NAVIGABLE_TOUR_PATHS,
  ROLES,
  TOUR_STEPS,
  dutyGlossaryForRole,
  featureById,
  featuresForRole,
  reservedDutyTokens,
  roleById,
  stepsForCurrentLeg,
  tourEntryRoutes,
  tourStepById,
  tourStepsForRole,
  type RoleId,
} from '@/lib/onboarding'
import { ADMIN_LINKS, PUBLIC_LINKS } from '@/lib/nav-links'

const ROLE_IDS: RoleId[] = ['fan', 'user', 'scout', 'tournament_admin', 'app_admin']

/** Concatenated source of `src/`, so the tour can be checked against the real UI. */
function readSourceTree(dir = join(process.cwd(), 'src')): string {
  return readdirSync(dir)
    .flatMap((entry) => {
      const path = join(dir, entry)
      if (statSync(path).isDirectory()) return readSourceTree(path)
      return /\.(tsx|ts)$/.test(entry) ? [readFileSync(path, 'utf8')] : []
    })
    .join('\n')
}

const SOURCE = readSourceTree()

function anchorName(selector: string): string {
  return selector.replace('[data-tour="', '').replace('"]', '')
}

/**
 * Structural contract for the onboarding system.
 *
 * The guide page and the in-app tour are both generated from
 * `src/lib/onboarding.ts`, so these assertions keep the documentation honest:
 * every role must have a journey, every duty token must be explained, every
 * tour stop must have a legal selector and a legal route, and every nav link
 * must be documented for at least one role.
 */

describe('onboarding — roles', () => {
  it('covers exactly the five launch roles', () => {
    expect(ROLES.map((role) => role.id)).toEqual(ROLE_IDS)
  })

  it('gives every role a journey and a feature list', () => {
    for (const role of ROLES) {
      expect(role.label.length, `${role.id} label`).toBeGreaterThan(0)
      expect(role.summary.length, `${role.id} summary`).toBeGreaterThan(80)
      expect(role.journey.length, `${role.id} journey`).toBeGreaterThanOrEqual(3)
      expect(role.featureIds.length, `${role.id} features`).toBeGreaterThanOrEqual(5)
      for (const step of role.journey) {
        expect(step.title.length, `${role.id} journey title`).toBeGreaterThan(0)
        expect(step.detail.length, `${role.id} journey detail`).toBeGreaterThan(20)
        if (step.href !== undefined) expect(step.href.startsWith('/'), `${role.id} journey href`).toBe(true)
      }
    }
  })

  it('resolves every role feature id to a feature that lists that role', () => {
    for (const role of ROLES) {
      for (const id of role.featureIds) {
        const feature = featureById(id)
        expect(feature.roles, `${role.id} → ${id}`).toContain(role.id)
      }
    }
  })

  it('resolves roles and features by id', () => {
    for (const id of ROLE_IDS) {
      expect(roleById(id).id).toBe(id)
      expect(featuresForRole(id).length).toBeGreaterThan(0)
    }
  })
})

describe('onboarding — features', () => {
  it('has unique ids and non-empty what/how copy', () => {
    const ids = FEATURES.map((feature) => feature.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const feature of FEATURES) {
      expect(feature.title.length, `${feature.id} title`).toBeGreaterThan(0)
      expect(feature.route.startsWith('/'), `${feature.id} route`).toBe(true)
      expect(feature.what.length, `${feature.id} what`).toBeGreaterThan(20)
      expect(feature.how.length, `${feature.id} how`).toBeGreaterThan(10)
      expect(feature.roles.length, `${feature.id} roles`).toBeGreaterThan(0)
      if (feature.tourId !== undefined) {
        expect(tourStepById(feature.tourId).id, `${feature.id} tour`).toBe(feature.tourId)
      }
    }
  })

  it('documents every public nav link for at least one role', () => {
    const routes = new Set(FEATURES.map((feature) => feature.route))
    for (const link of [...PUBLIC_LINKS, ...ADMIN_LINKS]) {
      const covered = [...routes].some(
        (route) => route === link.href || route === `${link.href}/[id]` || route === `${link.href}/[token]`
      )
      expect(covered, `nav link ${link.href}`).toBe(true)
    }
  })
})

describe('onboarding — tour', () => {
  it('has unique ids, legal selectors and navigable entry routes', () => {
    const ids = TOUR_STEPS.map((step) => step.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const step of TOUR_STEPS) {
      expect(step.title.length, `${step.id} title`).toBeGreaterThan(0)
      expect(step.body.length, `${step.id} body`).toBeGreaterThan(20)
      expect(step.selector.startsWith('[data-tour="'), `${step.id} selector`).toBe(true)
      expect(step.selector.endsWith('"]'), `${step.id} selector`).toBe(true)
      expect(step.roles.length, `${step.id} roles`).toBeGreaterThan(0)
      for (const role of step.roles) expect(ROLE_IDS, `${step.id} role ${role}`).toContain(role)
    }
  })

  it('gives every role at least three stops, reachable from a navigable page', () => {
    for (const id of ROLE_IDS) {
      const steps = tourStepsForRole(id)
      expect(steps.length, `${id} steps`).toBeGreaterThanOrEqual(3)
      const entries = tourEntryRoutes(id)
      expect(entries.length, `${id} entry routes`).toBeGreaterThan(0)
      for (const entry of entries) {
        expect(NAVIGABLE_TOUR_PATHS, `${id} entry ${entry}`).toContain(entry)
      }
    }
  })

  it('points every stop at a real component anchor in src/', () => {
    const missing: string[] = []
    for (const step of TOUR_STEPS) {
      const anchor = anchorName(step.selector)
      const wired =
        SOURCE.includes(`data-tour="${anchor}"`) || SOURCE.includes(`tour="${anchor}"`)
      if (!wired) missing.push(`${step.id} → ${anchor}`)
    }
    expect(missing).toEqual([])
  })

  it('matches `stepsForCurrentLeg` against the current pathname only', () => {
    const slash = /^\/admin\/match\//.test('/admin/match') ? 'admin-match' : 'other'
    expect(slash).toBe('other')
    expect(stepsForCurrentLeg('fan', '/').every((step) => step.path === '/')).toBe(true)
    expect(stepsForCurrentLeg('scout', '/admin/match/abc')?.length).toBeGreaterThan(0)
    expect(stepsForCurrentLeg('fan', '/admin')).toEqual([])
  })
})

describe('onboarding — duties', () => {
  it('documents every reserved duty token plus the four pattern forms', () => {
    const tokens = new Set(DUTY_DOCS.map((doc) => doc.token))
    for (const token of reservedDutyTokens()) {
      expect(tokens.has(token), `duty token ${token}`).toBe(true)
      expect(RESERVED_DUTIES.has(token), `reserved duty ${token}`).toBe(true)
    }
    for (const pattern of ['stat:<key>', 'event:<type>', 'fixture:<uuid>']) {
      expect(tokens.has(pattern), `duty pattern ${pattern}`).toBe(true)
    }
    expect(tokens.has('stat:<key>@<fixture>'), 'scoped stat pattern').toBe(true)
    expect(tokens.has('event:<type>@<fixture>'), 'scoped event pattern').toBe(true)
  })

  it('labels every documented duty through the same client grammar', () => {
    for (const doc of DUTY_DOCS) {
      expect(doc.kind.length, doc.token).toBeGreaterThan(0)
      expect(doc.can.length, doc.token).toBeGreaterThan(20)
      expect(doc.roles.length, doc.token).toBeGreaterThan(0)
      if (!doc.token.includes('<')) {
        expect(dutyLabel(doc.token).length, doc.token).toBeGreaterThan(0)
      }
    }
  })

  it('scopes the glossary per role', () => {
    expect(dutyGlossaryForRole('fan').length).toBe(0)
    expect(dutyGlossaryForRole('user').length).toBe(0)
    expect(dutyGlossaryForRole('scout').length).toBeGreaterThan(0)
    expect(dutyGlossaryForRole('tournament_admin').length).toBe(DUTY_DOCS.length)
    expect(dutyGlossaryForRole('app_admin').length).toBe(DUTY_DOCS.length)
  })
})