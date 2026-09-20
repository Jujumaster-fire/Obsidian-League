import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Structural contract for `supabase/db-setup.sql`.
 *
 * The file is the single source of truth for the database and is documented as
 * "safe to run repeatedly". These assertions protect that promise: they fail if
 * a future edit introduces a non-idempotent statement, drops a writer RPC, or
 * reintroduces the hardcoded event vocabulary the file was created to remove.
 *
 * They are deliberately structural, not behavioural — actually executing the
 * SQL needs a live Postgres, which `npm run smoke` covers post-deploy.
 */

const root = process.cwd()
const sql = readFileSync(join(root, 'supabase', 'db-setup.sql'), 'utf8')

const count = (needle: string) => sql.split(needle).length - 1

/**
 * Returns the names of SECURITY DEFINER functions whose own definition (from
 * its CREATE statement to the matching $fn$; / $$; terminator) does not carry
 * a SET search_path clause. Computed in TS rather than asserted with a global
 * counter, so lazy matches can't hide the helper's own $fn$; boundary.
 */
function findDefinerWithoutSearchPath(source: string): string[] {
  const missing: string[] = []
  const header = /CREATE OR REPLACE FUNCTION public\.([A-Za-z0-9_]+)/g
  let match: RegExpExecArray | null
  while ((match = header.exec(source)) !== null) {
    const start = match.index
    const closeDollar = source.indexOf('$$;', start)
    const closeTag = source.indexOf('$fn$;', start)
    const end =
      closeDollar === -1 ? closeTag : closeTag === -1 ? closeDollar : Math.min(closeDollar, closeTag)
    if (end === -1) continue
    const body = source.slice(start, end + '$fn$;'.length)
    if (body.includes('SECURITY DEFINER') && !body.includes('SET search_path')) {
      missing.push(match[1])
    }
  }
  return missing
}
/**
 * Returns the text of the LAST definition of `public.<name>(` up to the next
 * function definition. Later parts deliberately supersede earlier definitions
 * with the same signature (hardened bodies replacing legacy stubs), so the
 * version Postgres ends up with is the last one in the file — `indexOf` finds
 * the superseded one instead.
 */
function lastDefinitionOf(name: string): string {
  const marker = `CREATE OR REPLACE FUNCTION public.${name}(`
  const start = sql.lastIndexOf(marker)
  if (start === -1) throw new Error(`db-setup.sql: missing function public.${name}`)
  const next = sql.indexOf('CREATE OR REPLACE FUNCTION', start + marker.length)
  return sql.slice(start, next === -1 ? undefined : next)
}

describe('db-setup.sql — idempotency', () => {
  it('guards every CREATE TABLE', () => {
    expect(sql).not.toMatch(/^CREATE TABLE (?!IF NOT EXISTS)/m)
    expect(count('CREATE TABLE IF NOT EXISTS')).toBeGreaterThan(15)
  })

  it('guards every CREATE INDEX', () => {
    expect(sql).not.toMatch(/^CREATE (?:UNIQUE )?INDEX (?!IF NOT EXISTS)/m)
  })

  it('guards every ADD COLUMN against re-runs', () => {
    const sameLine = sql.match(/^ALTER TABLE [^\n]*ADD COLUMN [^\n]*$/gm) ?? []
    const sameLineUnguarded = sameLine.filter((line) => !line.includes('IF NOT EXISTS'))
    expect(sameLineUnguarded).toEqual([])

    const wrapped = sql.match(/^\s+ADD COLUMN [^\n]*$/gm) ?? []
    for (const line of wrapped) expect(line).toContain('IF NOT EXISTS')
    expect(sameLine.length + wrapped.length).toBeGreaterThan(20)
  })

  it('uses CREATE OR REPLACE for every function', () => {
    expect(sql).not.toMatch(/^CREATE FUNCTION/m)
    expect(count('CREATE OR REPLACE FUNCTION')).toBeGreaterThan(40)
  })

  it('balances dollar-quoted blocks (tag-aware pairing)', () => {
    // The naive `count('$$') % 2` check missed the real bug twice: migration 09
    // shipped with BOTH a missing `$$;` after a DO block and a stray `$$;` at
    // EOF, which cancelled each other out numerically. Delimiters must pair
    // sequentially with matching tags instead.
    const delimiters = (sql.match(/\$[A-Za-z_]*\$/g) ?? []).map((token) =>
      token.slice(1, -1)
    )
    expect(delimiters.length % 2).toBe(0)

    const stack: string[] = []
    for (const tag of delimiters) {
      if (stack.length > 0 && stack[stack.length - 1] === tag) stack.pop()
      else stack.push(tag)
    }
    expect(stack, 'unclosed dollar-quoted block').toEqual([])
  })

  it('never drops a function (only replaces, or drops constraints/policies)', () => {
    expect(sql).not.toMatch(/DROP FUNCTION/i)
  })
})

describe('db-setup.sql — every policy is re-runnable', () => {
  it('drops by name before creating', () => {
    const created = sql.match(/CREATE POLICY "([^"]+)"/g) ?? []
    const dropped = new Set(
      (sql.match(/DROP POLICY IF EXISTS "([^"]+)"/g) ?? []).map((line) =>
        line.replace(/DROP POLICY IF EXISTS "/, '').replace(/"$/, ''),
      ),
    )
    // Policies created dynamically inside DO blocks are exempt: they are
    // guarded by a pg_policies existence check with the same literal name, or
    // generated from a table/action row (the named PG09 loop), in which case
    // the literal name appears at least twice (creation + guard).
    const missing: string[] = []
    for (const line of created) {
      const name = line.replace(/CREATE POLICY "/, '').replace(/"$/, '')
      if (dropped.has(name)) continue
      const occurrences = sql.split(name).length - 1
      if (occurrences >= 2) continue
      if (!missing.includes(name)) missing.push(name)
    }
    expect(missing).toEqual([])
  })

  it('guards the dynamically-created policies with pg_policies lookups', () => {
    expect(count('policyname =')).toBeGreaterThan(10)
  })
})

describe('db-setup.sql — realtime + RLS coverage', () => {
  it('publishes the tables the console subscribes to', () => {
    for (const table of ['fixtures', 'match_events', 'fixture_entries', 'fixture_loggers']) {
      expect(sql).toContain(`ALTER PUBLICATION supabase_realtime ADD TABLE public.${table}`)
      expect(sql).toContain(`ALTER TABLE public.${table} REPLICA IDENTITY FULL`)
    }
  })

  it('enables RLS on every table it creates', () => {
    expect(count('ENABLE ROW LEVEL SECURITY')).toBeGreaterThan(15)
  })

  it('pins search_path on every SECURITY DEFINER function', () => {
    expect(count('SECURITY DEFINER')).toBeGreaterThan(20)
    const missing = findDefinerWithoutSearchPath(sql)
    expect(missing).toEqual([])
  })
})

describe('db-setup.sql — writer RPC surface (PART 13/14)', () => {
  const writers = [
    'has_tournament_duty',
    'can_write_fixture',
    'can_write_fixture_score',
    'can_write_fixture_clock',
    'can_write_fixture_rules',
    'can_write_fixture_stat',
    'can_log_fixture_event',
    'can_write_fixture_entries',
    'can_write_fixture_lineup',
    'fixture_scope_authorized',
    'claim_fixture_scope',
    'heartbeat_fixture_scope',
    'release_fixture_scope',
    'list_fixture_loggers',
    'fixture_effective_rules',
    'fixture_stat_allowed',
    'fixture_event_allowed',
    'fixture_stat_input',
    'record_stat',
    'set_fixture_stat',
    'record_score',
    'record_score_delta',
    'update_match_clock',
    'record_match_event',
    'delete_match_event',
    'upsert_fixture_entry',
    'set_fixture_rules',
    'clear_fixture_rules',
    'assert_vocab_shape',
    'upsert_sport',
    'upsert_sport_vocab',
    'create_athlete',
    'update_athlete',
    'delete_athlete',
    'set_fixture_lineup',
  ]

  it.each(writers)('defines %s', (name) => {
    expect(sql).toContain(`CREATE OR REPLACE FUNCTION public.${name}(`)
  })

  it.each(writers)('grants EXECUTE on %s', (name) => {
    expect(sql).toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${name}\\(`))
  })
})

describe('db-setup.sql — multi-logger guarantees', () => {
  it('enforces one logger per stream with a unique index', () => {
    expect(sql).toContain('CREATE UNIQUE INDEX uq_fixture_loggers_scope')
    // The index pins (fixture_id, scope) over one or several physical lines.
    const start = sql.indexOf('CREATE UNIQUE INDEX uq_fixture_loggers_scope')
    const snippet = sql.slice(start, start + 400)
    expect(snippet).toContain('public.fixture_loggers')
    expect(snippet).toContain('fixture_id')
    expect(snippet).toContain('scope')
  })

  it('routes every live write through a duty check', () => {
    for (const rpc of ['record_stat', 'record_score', 'record_match_event', 'set_fixture_rules']) {
      const body = lastDefinitionOf(rpc)
      expect(body).toMatch(/can_write_fixture|can_log_fixture_event/)
    }
  })

  it('keeps the tournament boundary absolute (no cross-tournament writes)', () => {
    const body = lastDefinitionOf('can_write_fixture')
    expect(body).toContain('f.tournament_id')
    expect(body).toContain('m.tournament_id = v_tournament_id')
    expect(body).toContain('m.user_id = auth.uid()')
  })

  it('gives app admins a single documented bypass', () => {
    const body = lastDefinitionOf('can_write_fixture')
    expect(body).toContain('public.is_app_admin()')
  })
})

describe('db-setup.sql — no hardcoded vocabularies', () => {
  it('replaced the frozen event_type CHECK with a format CHECK', () => {
    // PART 12 drops the vocabulary CHECK and adds a format-only CHECK. The
    // name still appears in PART 05/10 code paths that conditionally drop or
    // re-add it, so assert the *final* constraint state, not the absence of
    // the historical name.
    expect(sql).toContain('match_events_event_type_format_check')
    expect(sql).toContain(
      "ADD CONSTRAINT match_events_event_type_format_check\n            CHECK (event_type ~ '^[a-z][a-z0-9_]{0,48}$')",
    )
  })

  it('validates event types against the fixture vocabulary at write time', () => {
    const body = lastDefinitionOf('record_match_event')
    expect(body).toContain('public.fixture_event_allowed(p_fixture_id, p_event_type)')
  })

  it('removes the membership-wide match_events policies first', () => {
    // They must be dropped; Postgres would otherwise OR them together with the
    // duty-scoped ones and the gate would never apply.
    for (const action of ['insert', 'update', 'delete']) {
      expect(sql).toContain(`DROP POLICY IF EXISTS "Tournament members can ${action} match events"`)
    }
  })
})

describe('db-setup.sql — futsal + editable rules', () => {
  it('seeds futsal into the sport catalogue', () => {
    expect(sql).toMatch(/\(\s*'futsal', 'Futsal', 'duel'/)
  })

  it('gives futsal a 20-minute clock under both the modern and legacy keys', () => {
    // Anchor on the futsal VALUES tuple: the clock blocks sit between it and
    // the UPDATE's WHERE clause, which is the LAST line of that statement.
    const block = sql.slice(
      sql.indexOf("'futsal', 'Futsal', 'duel'"),
      sql.indexOf("WHERE code = 'futsal'"),
    )
    // Modern shape read by the multi-logger console…
    expect(block).toContain('"type":"halves"')
    expect(block).toContain('"period_minutes":20')
    // …and the legacy flat shape the old seeds/readers use.
    expect(block).toContain('"half_minutes":20')
  })

  it('stores per-fixture overrides separately from the global catalogue', () => {
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS rules_override JSONB')
    expect(sql).toContain('public.fixture_effective_rules(')
  })

  it('rejects unknown rule keys and negative allocations', () => {
    const body = lastDefinitionOf('set_fixture_rules')
    expect(body).toContain("RAISE EXCEPTION 'Unknown rule")
    expect(body).toContain('must not be negative')
  })

  it('restricts the global catalogue to app admins only', () => {
    for (const rpc of ['upsert_sport', 'upsert_sport_vocab']) {
      const body = lastDefinitionOf(rpc)
      expect(body).toContain('IF NOT public.is_app_admin() THEN')
    }
  })
})

describe('db-setup.sql — attribution and de-duplication', () => {
  it('stamps who logged each timeline entry', () => {
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS logged_by UUID')
    const body = lastDefinitionOf('record_match_event')
    expect(body).toContain('auth.uid()')
  })

  it('makes fixture entries genuinely updatable', () => {
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ')
    expect(sql).toContain('CREATE UNIQUE INDEX IF NOT EXISTS uq_fixture_entries_fixture_athlete')
    expect(sql).toContain('CREATE UNIQUE INDEX IF NOT EXISTS uq_fixture_entries_fixture_team')
    const body = lastDefinitionOf('upsert_fixture_entry')
    expect(body).toContain('DO UPDATE SET')
    expect(body).not.toContain('ON CONFLICT DO NOTHING')
  })

  it('collapses pre-existing duplicate entries before adding the unique indexes', () => {
    expect(sql).toContain('ROW_NUMBER() OVER (')
    const cleanup = sql.indexOf('WITH ranked AS')
    const index = sql.indexOf('CREATE UNIQUE INDEX IF NOT EXISTS uq_fixture_entries_fixture_athlete')
    expect(cleanup).toBeGreaterThan(-1)
    expect(index).toBeGreaterThan(cleanup)
  })
})

describe('db-setup.sql — hardening (invite secrecy, duty scoping, storage)', () => {
  /**
   * Walk every policy creation/drop in file order and keep the surviving set, so
   * assertions describe the FINAL policy state rather than the legacy stubs the
   * early parts deliberately create and later parts replace.
   *
   * Two kinds of drop exist in the file:
   *   1. literal `DROP POLICY "name" ON public.table` (often inside an
   *      `IF EXISTS` guard), and
   *   2. the PART 09 hardening loop, which drops a table/name list via
   *      `EXECUTE format('DROP POLICY %I ON public.%I', …)`.
   * Both are modelled here, otherwise the legacy `is_admin()` policies that the
   * loop removes would look like they were still in force.
   */
  function finalPolicies(): { table: string; name: string; body: string }[] {
    const alive = new Map<string, { table: string; name: string; body: string }>()

    type Event = { at: number; kind: 'create' | 'drop'; table: string; name: string; body: string }
    const events: Event[] = []

    const pattern =
      /(?:CREATE POLICY "([^"]+)"\s*\n?\s*ON ([a-z_.]+)|DROP POLICY (?:IF EXISTS )?"([^"]+)"\s*\n?\s*ON ([a-z_.]+))/g
    let match: RegExpExecArray | null
    while ((match = pattern.exec(sql)) !== null) {
      if (match[1]) {
        events.push({
          at: match.index,
          kind: 'create',
          table: match[2],
          name: match[1],
          body: sql.slice(match.index, sql.indexOf(';', match.index) + 1),
        })
      } else if (match[3]) {
        events.push({ at: match.index, kind: 'drop', table: match[4], name: match[3], body: '' })
      }
    }

    // The dynamic legacy-policy drop loop.
    const loop = /SELECT \* FROM \(VALUES([\s\S]*?)\) AS legacy\(tbl, pol\)/.exec(sql)
    if (loop) {
      const pairs = /\(\s*'(\w+)',\s*'([^']+)'\s*\)/g
      let pair: RegExpExecArray | null
      while ((pair = pairs.exec(loop[1])) !== null) {
        events.push({ at: loop.index, kind: 'drop', table: pair[1], name: pair[2], body: '' })
      }
    }

    events.sort((left, right) => left.at - right.at)
    for (const event of events) {
      const table = event.table.replace(/^(public|storage)\./, '')
      const key = `${table}::${event.name}`
      if (event.kind === 'create') alive.set(key, event)
      else alive.delete(key)
    }

    return [...alive.values()].map(({ table, name, body }) => ({ table, name, body }))
  }

  /**
   * Text of the LAST `CREATE POLICY "<name>"` statement (later parts supersede
   * earlier ones), from the statement start to the terminating `;`.
   */
  function lastPolicyDefinition(name: string): string {
    const marker = `CREATE POLICY "${name}"`
    const start = sql.lastIndexOf(marker)
    if (start === -1) throw new Error(`db-setup.sql: missing policy "${name}"`)
    const end = sql.indexOf(';', start)
    return sql.slice(start, end + 1)
  }

  it('never leaves a surviving policy gated on the legacy is_admin()', () => {
    const offenders = finalPolicies().filter((policy) => policy.body.includes('is_admin()'))
    expect(offenders.map((policy) => policy.body.split('\n')[0])).toEqual([])
  })

  it('keeps invite tokens secret: no public SELECT policy and no anon grant', () => {
    // The legacy public invite policy is created in migration 08 then removed by
    // the migration 09 hardening loop, so its CREATE text legitimately remains in
    // the file. Assert on the FINAL surviving set, not with not.toContain on the
    // whole file (which also catches the still-present CREATE statement).
    const inviteSurvivors = finalPolicies()
            .filter((p) => p.table.endsWith('tournament_invites'))
      .map((p) => p.name)
    expect(inviteSurvivors).not.toContain('Public can view valid invites')
    expect(inviteSurvivors).toEqual(
      expect.arrayContaining([
        'App admins can view invites',
        'Tournament managers can view invites',
      ]),
    )
    expect(sql).toContain('DROP POLICY "Public can view valid invites" ON public.tournament_invites;')
        expect(sql).toContain('REVOKE SELECT ON public.tournament_invites FROM anon;')
    expect(sql).toContain('REVOKE SELECT ON public.tournament_invites FROM authenticated;')
        // An early part grants SELECT to anon for the public invite policy; the mig 09
    // hardening loop follows it with a matching REVOKE, so assert ordering rather
    // than absence — the grant text legitimately remains in the single-shot file.
    expect(sql).toContain('GRANT SELECT ON public.tournament_invites TO anon')
    expect(sql.indexOf('REVOKE SELECT ON public.tournament_invites FROM anon;'))
      .toBeGreaterThan(sql.indexOf('GRANT SELECT ON public.tournament_invites TO anon'))
  })

  it('scopes tournament_posts and tournament_settings writes by duty, not membership', () => {
    for (const action of ['insert', 'update', 'delete']) {
      const body = lastPolicyDefinition(`Tournament members can ${action} tournament posts`)
      expect(body).toContain("m.duties @> ARRAY['*'] OR m.duties @> ARRAY['posts']")
    }
    for (const action of ['insert', 'update', 'delete']) {
      const body = lastPolicyDefinition(`Tournament members can ${action} tournament settings`)
      expect(body).toContain("m.duties @> ARRAY['*']")
      expect(body).not.toContain('is_tournament_admin(tournament_id)')
    }
  })

  it('locks the public logos bucket to app admins', () => {
    // The broad `bucket_id = 'logos' AND public.is_admin()` policy is created in
    // an early storage part and dropped by the migration 09 hardening loop, so
    // assert on the FINAL surviving set: legacy 'Admins can ... logos' must be
    // gone and only 'App admins can ... logos' may remain.
    const survivingLogos = finalPolicies()
            .filter((p) => p.table.endsWith('objects'))
      .map((p) => p.name)
    for (const action of ['insert', 'update', 'delete']) {
      expect(survivingLogos).not.toContain(`Admins can ${action} logos`)
      expect(survivingLogos).toContain(`App admins can ${action} logos`)
      expect(sql).toContain(`DROP POLICY "Admins can ${action} logos" ON storage.objects;`)
      expect(sql).toContain(`CREATE POLICY "App admins can ${action} logos"`)
      expect(sql).toContain("WHERE ur.user_id = auth.uid() AND ur.role = 'app_admin'")
    }
  })

  it('still enables RLS on every table it creates (table ↔ RLS parity)', () => {
    const tables = new Set(
      (sql.match(/CREATE TABLE IF NOT EXISTS public\.(\w+)/g) ?? []).map((line) =>
        line.replace('CREATE TABLE IF NOT EXISTS public.', '')
      )
    )
    const secured = new Set(
      (sql.match(/ALTER TABLE public\.(\w+) ENABLE ROW LEVEL SECURITY/g) ?? []).map((line) =>
        line.replace('ALTER TABLE public.', '').replace(' ENABLE ROW LEVEL SECURITY', '')
      )
    )
    expect([...tables].filter((table) => !secured.has(table))).toEqual([])
    expect(tables.size).toBeGreaterThan(15)
  })
})

describe('db-setup.sql — documentation', () => {
  it('documents how to run it and that it is repeatable', () => {
    expect(sql).toContain('HOW TO RUN')
    expect(sql).toContain('SAFE TO RUN REPEATEDLY')
  })

  it('documents the full duty grammar', () => {
    for (const token of ['stat:<key>', 'event:<type>', 'fixture:<uuid>', 'stat:<key>@<fixture>']) {
      expect(sql).toContain(token)
    }
  })
})

describe('db-setup.sql — fixture lineups (PART 15)', () => {
  it('creates the lineup table and its unique slot index', () => {
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.fixture_lineups')
    expect(sql).toContain('CREATE UNIQUE INDEX IF NOT EXISTS uq_fixture_lineups_slot')
  })

  it('keeps coordinates inside the 0..1 unit square', () => {
    const body = lastDefinitionOf('set_fixture_lineup')
    expect(body).toContain('Coordinates must be between 0 and 1')
    expect(sql).toContain('CONSTRAINT fixture_lineups_x_range_check CHECK (x >= 0 AND x <= 1)')
    expect(sql).toContain('CONSTRAINT fixture_lineups_y_range_check CHECK (y >= 0 AND y <= 1)')
  })

  it('never puts a player and an athlete in the same slot', () => {
    const body = lastDefinitionOf('set_fixture_lineup')
    expect(body).toContain('either a player or an athlete, not both')
    expect(sql).toContain('fixture_lineups_single_subject_check')
  })

  it('gates every write on the lineup duty', () => {
    const gate = lastDefinitionOf('can_write_fixture_lineup')
    expect(gate).toContain("ARRAY['lineup']")
    const body = lastDefinitionOf('set_fixture_lineup')
    expect(body).toContain('public.can_write_fixture_lineup(p_fixture_id)')
  })

  it('exposes the lineup to the public and to realtime', () => {
    expect(sql).toContain('CREATE POLICY "Public can view fixture lineups"')
    expect(sql).toContain('ALTER TABLE public.fixture_lineups ENABLE ROW LEVEL SECURITY')
    expect(sql).toContain('ALTER TABLE public.fixture_lineups REPLICA IDENTITY FULL')
    expect(sql).toMatch(/ALTER PUBLICATION supabase_realtime ADD TABLE public\.fixture_lineups/)
  })

  it('keeps the lineup duty out of the bare stat/event key fallback', () => {
    // 'lineup' is a reserved word, so a member whose duty happens to read
    // 'lineup' can never be mistaken for a stat called 'lineup'.
    const body = lastDefinitionOf('can_write_fixture')
    expect(body).toContain("'lineup'")
    expect(sql).toContain("ARRAY['lineup']")
  })
})

describe('db-setup.sql — per-sport court config', () => {
  it('seeds the court shape into the futsal catalogue entry', () => {
    const block = sql.slice(
      sql.indexOf("'futsal', 'Futsal', 'duel'"),
      sql.indexOf("WHERE code = 'futsal'"),
    )
    expect(block).toContain('"shape":"pitch"')
    expect(block).toContain('"orientation":"horizontal"')
  })

  it('accepts court as a rule override key and rejects unknown shapes', () => {
    const body = lastDefinitionOf('set_fixture_rules')
    expect(body).toContain("'court'")
    expect(body).toContain("('pitch', 'court', 'pool', 'track', 'none')")
    expect(body).toContain('Unsupported court shape')
  })
})

/**
 * Regression guard for unterminated dollar-quoted blocks.
 *
 * Migration 09 shipped a `DO $$ … END` with the closing `$$;` missing, so the
 * block swallowed the following `CREATE OR REPLACE FUNCTION … AS $$ BEGIN`.
 * Postgres reported `syntax error at or near "BEGIN" (42601)` only at
 * execution time, so nothing caught it until the first live `db push`.
 *
 * The signature is unmistakable: the text of a `DO` body can never contain a
 * function definition. Matching each `DO $tag$ … $tag$;` non-greedily means an
 * unterminated block runs on into the next definition and trips this assertion.
 */
describe('SQL dollar-quoting', () => {
  const sqlFiles: string[] = [
    join(root, 'supabase', 'db-setup.sql'),
    ...readdirSync(join(root, 'supabase', 'migrations'))
      .filter((name) => name.endsWith('.sql'))
      .sort()
      .map((name) => join(root, 'supabase', 'migrations', name)),
  ]

  const doBlocks = (source: string): string[] => {
    const bodies: string[] = []
    const pattern = /DO \$([A-Za-z_]*)\$([\s\S]*?)\$\1\$;/g
    let match: RegExpExecArray | null
    while ((match = pattern.exec(source)) !== null) bodies.push(match[2])
    return bodies
  }

  for (const file of sqlFiles) {
    const label = file.replace(`${root}\\`, '').replace(`${root}/`, '')

    it(`${label}: every DO block is terminated`, () => {
      const source = readFileSync(file, 'utf8')
      const bodies = doBlocks(source)

      // A file that declares `DO $…` must parse at least one block; a file with
      // no DO blocks at all (pure ALTER/CREATE/INSERT migrations) is fine.
      if (/DO \$/.test(source)) {
        expect(bodies.length, `${label} declares DO but parsed no block`).toBeGreaterThan(0)
      }

      const swallowing = bodies.filter((body) =>
        /CREATE OR REPLACE FUNCTION/.test(body)
      )
      expect(
        swallowing.map((body) => body.slice(0, 80)),
        `${label}: a DO block swallowed a function definition (missing \`$$;\`)`
      ).toEqual([])
    })
  }
})
