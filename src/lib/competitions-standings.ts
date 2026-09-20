// ------------------------------------------------------------------
// Competitions-view computation - pure server module.
//
// All of this used to run inside the client component
// `src/app/competitions/page.tsx`. Moving it to a server module means
// the first paint is served from the Next.js cache (or PostgREST on
// cold cache) without the browser downloading four whole tables and
// re-deriving standings/stats in the client.
//
// Row shapes below mirror the PostgREST projections used by
// `src/app/competitions/page.tsx` (they are intentionally local: the
// shared `AdminWidgets` types describe narrow admin-form fields, not
// the full rows this module needs).
// ------------------------------------------------------------------

export interface Fixture {
  id: string
  match_date: string
  status: string | null
  stage: string | null
  venue: string | null
  tournament_id: string | null
  home_score: number | null
  away_score: number | null
  current_minute: number | null
  home_xg: number | null
  away_xg: number | null
  home_clean_sheet: boolean | null
  away_clean_sheet: boolean | null
  home_goalkeeper_id: string | null
  away_goalkeeper_id: string | null
  home_team_id: string
  away_team_id: string
  home_team: { name: string | null; short_name: string | null } | null
  away_team: { name: string | null; short_name: string | null } | null
}

export interface Team {
  id: string
  name: string
  short_name: string | null
  logo_url: string | null
  group_name: string | null
}

export interface Event {
  id: string
  event_type: string | null
  player_id: string | null
  assist_player_id: string | null
}

export interface Player {
  id: string
  name: string
  team_id: string | null
  team?: { name: string | null } | null
}

export interface CompetitionsView {
  results: Fixture[]
  upcoming: Fixture[]
  standings: Record<string, StandingsRow[]>
  topScorers: TopPlayerRow[]
  topAssists: TopPlayerRow[]
  topYellow: TopPlayerRow[]
  topRed: TopPlayerRow[]
  teamXg: { team: Team; xg: number }[]
  topCleanSheets: TopPlayerRow[]
  playoffMatches: Fixture[]
  groupNames: string[]
}

export interface StandingsRow {
  id: string
  name: string
  short_name: string | null
  logo: string | null
  played: number
  won: number
  drawn: number
  lost: number
  goalsFor: number
  goalsAgainst: number
  points: number
  gd: number
}

export interface TopPlayerRow {
  player: Player | undefined
  value: number
}

const KNOWN_TABS = new Set([
  'overview','results','fixtures','stats','groups','playoffs'
])

export function isKnownTab(label: string): boolean {
  return KNOWN_TABS.has(label)
}

export function computeCompetitionsView(
  fixtures: Fixture[],
  teams: Team[],
  events: Event[],
  players: Player[],
): CompetitionsView {
  const results: Fixture[] = []
  const upcoming: Fixture[] = []
  for (const f of fixtures) {
    if (f.status === 'full_time') results.push(f)
    else if (f.status !== 'cancelled') upcoming.push(f)
  }
  results.sort((a,b)=> new Date(b.match_date).getTime() - new Date(a.match_date).getTime())

  const menuById = new Map(players.map(p=>[p.id,p]))
  const teamById = new Map(teams.map(t=>[t.id,t]))

  const groupStats: Record<string,StandingsRow[]> = {}
  for (const t of teams) {
    if (!t.group_name) continue
    groupStats[t.group_name] ??= []
    groupStats[t.group_name].push({
      id:t.id, name:t.name, short_name:t.short_name, logo:t.logo_url,
      played:0, won:0, drawn:0, lost:0,
      goalsFor:0, goalsAgainst:0, points:0, gd:0,
    })
  }

  for (const f of results) {
    if (f.stage !== 'group_stage') continue
    const hs = teamById.get(f.home_team_id)
    const as = teamById.get(f.away_team_id)
    if (!hs || !as) continue
    const apply = (t:Team, gf:number, ga:number) => {
      if (!t.group_name || !groupStats[t.group_name]) return
      const row = groupStats[t.group_name].find(r=>r.id===t.id)
      if (!row) return
      row.played++
      row.goalsFor += gf
      row.goalsAgainst += ga
      if (gf>ga){row.won++;row.points+=3}
      else if (gf===ga){row.drawn++;row.points++}
      else {row.lost++}
      row.gd = row.goalsFor - row.goalsAgainst
    }
    apply(hs, f.home_score||0, f.away_score||0)
    apply(as, f.away_score||0, f.home_score||0)
  }

  const groupNames = Object.keys(groupStats).sort()
  for (const g of groupNames) {
    groupStats[g].sort((a,b)=>{
      if (b.points!==a.points) return b.points-a.points
      return b.gd-a.gd
    })
  }

  const sm:Record<string,number>={}, am:Record<string,number>={},
        ym:Record<string,number>={}, rm:Record<string,number>={}
  for (const e of events) {
    const pid=e.player_id, aid=e.assist_player_id, t=e.event_type
    if (t==='goal' && pid) sm[pid]=(sm[pid]||0)+1
    if (t==='goal' && aid) am[aid]=(am[aid]||0)+1
    if (t==='yellow_card' && pid) ym[pid]=(ym[pid]||0)+1
    if (t==='red_card' && pid) rm[pid]=(rm[pid]||0)+1
  }
  const e2r = (m:Record<string,number>)=>Object.keys(m).map(id=>({player:menuById.get(id),value:m[id]})).filter(r=>r.player).sort((a,b)=>b.value-a.value)
  const topScorers=e2r(sm).slice(0,10)
  const topAssists=e2r(am).slice(0,10)
  const topYellow=e2r(ym).slice(0,10)
  const topRed=e2r(rm).slice(0,10)

  const txm:Record<string,number>={}
  for (const f of results) {
    txm[f.home_team_id]=(txm[f.home_team_id]||0)+(f.home_xg||0)
    txm[f.away_team_id]=(txm[f.away_team_id]||0)+(f.away_xg||0)
  }
  const teamXg=Object.keys(txm).map(id=>({team:teamById.get(id)!,xg:txm[id]})).filter(r=>r.team).sort((a,b)=>b.xg-a.xg)

  const csm:Record<string,number>={}
  for (const f of results) {
    if (f.home_clean_sheet && f.home_goalkeeper_id) csm[f.home_goalkeeper_id]=(csm[f.home_goalkeeper_id]||0)+1
    if (f.away_clean_sheet && f.away_goalkeeper_id) csm[f.away_goalkeeper_id]=(csm[f.away_goalkeeper_id]||0)+1
  }
  const topCleanSheets=e2r(csm).slice(0,10)

  const playoffMatches:Fixture[]=[]
  for (const f of fixtures) if (f.stage!=='group_stage') playoffMatches.push(f)

  return {
    results, upcoming, standings:groupStats,
    topScorers, topAssists, topYellow, topRed, teamXg, topCleanSheets,
    playoffMatches, groupNames,
  }
}
