// Build migration 13 = PARTs 12 + 13 + 14 + 15 concatenated, in db-setup.sql's
// order. These parts are the scope-authority / recorder / lineup surface the
// migration chain was missing entirely — without them `db push` produces a
// database the live console cannot drive.
import { readFileSync, writeFileSync } from 'node:fs'

const parts = [
  'supabase/_parts/12_futsal_and_editable_rules.sql',
  'supabase/_parts/13_scope_duties_and_loggers.sql',
  'supabase/_parts/14_recorder_rpcs.sql',
  'supabase/_parts/15_fixture_lineups.sql',
]

const header = [
  '-- 13: scope authority, duty-checked recorder RPCs and fixture lineups.',
  '--',
  '-- Mirrors PARTs 12-15 of supabase/db-setup.sql. Without this migration the',
  '-- push path produces a database with no `has_tournament_duty()` /',
  '-- `can_write_fixture()` / `record_match_event()` / `claim_fixture_scope()` /',
  '-- `set_fixture_lineup()` / per-match rule surface, so the live console',
  '-- degrades on every fixture.',
  '--',
  '-- Generated from supabase/_parts/12..15: edit those parts, regenerate',
  '-- db-setup.sql, then mirror the change here (same rule as 00_base_schema.sql).',
  '-- Every statement is idempotent, so running it on a database that already',
  '-- has the surface (via db-setup.sql) is a no-op.',
  '',
].join('\n')

const body = parts
  .map((file) => readFileSync(file, 'utf8').replace(/\r\n/g, '\n').trimEnd())
  .join('\n\n')

writeFileSync('supabase/migrations/13_scope_duties_recorders_lineups.sql', header + body + '\n', 'utf8')
console.log(
  'written: supabase/migrations/13_scope_duties_recorders_lineups.sql —',
  Math.round((header.length + body.length) / 1024),
  'KB',
)
