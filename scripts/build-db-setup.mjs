// One-shot builder: assembles supabase/db-setup.sql from the ordered SQL parts.
// Run with: node scripts/build-db-setup.mjs
//
// The generated supabase/db-setup.sql is the single source of truth for the
// database. This script and the parts it reads are deleted once the file is
// generated — afterwards, edit db-setup.sql directly.

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, basename } from 'node:path'

const root = process.cwd()
const supabase = join(root, 'supabase')
const parts = join(supabase, '_parts')

const read = (path) => {
  if (!existsSync(path)) throw new Error(`Missing SQL part: ${path}`)
  return readFileSync(path, 'utf8').replace(/^\uFEFF/, '').trimEnd()
}

const MIGRATION_ORDER = [
  '01_add_team_details.sql',
  '02_tournaments_core.sql',
  '03_sports_catalog.sql',
  '04_seed_ccgames2026.sql',
  '05_athletes_entries_players.sql',
  '06_roles_invites_rpcs.sql',
  '07_tighten_legacy_policies.sql',
  '08_tournament_posts.sql',
  '09_harden_policies_and_admin_rpcs.sql',
  '10_african_sports_catalog_and_clock.sql',
  '11_athlete_and_entry_rpcs.sql',
]

const banner = (label) =>
  `\n-- ============================================================================\n` +
  `-- ${label}\n` +
  `-- ============================================================================\n`

let out = read(join(parts, '_header.sql')) + '\n'

out += banner('PART 0 — base schema (roles, teams, fixtures, match_events, settings)')
out += `\n${read(join(parts, '00_base.sql'))}\n`

for (const file of MIGRATION_ORDER) {
  const number = basename(file, '.sql').split('_')[0]
  out += banner(`PART ${number} — ${basename(file)}`)
  out += `\n${read(join(supabase, 'migrations', file))}\n`
}

out += banner('PART 12 — futsal + data-driven rules (fixtures.rules_override)')
out += `\n${read(join(parts, '12_futsal_and_editable_rules.sql'))}\n`

out += banner('PART 13 — scope authority, duties, fixture loggers')
out += `\n${read(join(parts, '13_scope_duties_and_loggers.sql'))}\n`

out += banner('PART 14 — recorder RPCs (every live-console write path)')
out += `\n${read(join(parts, '14_recorder_rpcs.sql'))}\n`

out += banner('PART 15 — fixture lineups (drag-editable formations)')
out += `\n${read(join(parts, '15_fixture_lineups.sql'))}\n`

out += `
-- ============================================================================
-- END OF SETUP
-- ============================================================================
-- Quick self-check: function count must be well above zero.
--   SELECT count(*) AS tables
--     FROM pg_tables WHERE schemaname = 'public';
--   SELECT count(*) AS functions
--     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public';
-- ============================================================================
`

const target = join(supabase, 'db-setup.sql')
writeFileSync(target, out, 'utf8')

const count = (re) => (out.match(re) ?? []).length

console.log(`Wrote ${target}`)
console.log(`  ${out.split('\n').length} lines, ${(out.length / 1024).toFixed(1)} KB`)
console.log(`  CREATE TABLE IF NOT EXISTS : ${count(/CREATE TABLE IF NOT EXISTS/g)}`)
console.log(`  CREATE OR REPLACE FUNCTION : ${count(/CREATE OR REPLACE FUNCTION/g)}`)
console.log(`  CREATE POLICY              : ${count(/CREATE POLICY/g)}`)
console.log(`  ALTER PUBLICATION          : ${count(/ALTER PUBLICATION/g)}`)
