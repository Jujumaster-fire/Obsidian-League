/**
 * Deployment smoke test — no dependencies, run with `npm run smoke`.
 *
 * Usage:
 *   node scripts/smoke.mjs                      # http://localhost:3000
 *   node scripts/smoke.mjs https://your-domain  # production / preview
 *
 * Checks the routes, headers and authorization boundaries that a deploy can
 * silently break. Exits non-zero when any check fails so it can gate a release.
 */

const baseUrl = (process.argv[2] ?? process.env.SMOKE_BASE_URL ?? 'http://localhost:3000').replace(
  /\/$/,
  ''
)

const results = []

async function check(name, run) {
  try {
    const detail = await run()
    results.push({ name, ok: true, detail: detail ?? '' })
  } catch (error) {
    results.push({ name, ok: false, detail: error instanceof Error ? error.message : String(error) })
  }
}

const get = async (path, init) => {
  const response = await fetch(`${baseUrl}${path}`, { redirect: 'manual', ...init })
  return response
}

const expectStatus = (response, expected, label) => {
  const allowed = Array.isArray(expected) ? expected : [expected]
  if (!allowed.includes(response.status)) {
    throw new Error(`${label}: expected ${allowed.join('/')} but got ${response.status}`)
  }
}

const expectContains = (body, needle, label) => {
  if (!body.includes(needle)) throw new Error(`${label}: response did not contain "${needle}"`)
}

await check('home page renders', async () => {
  const response = await get('/')
  expectStatus(response, 200, 'GET /')
  const body = await response.text()
  expectContains(body, 'Obsidian Elite', 'GET /')
  return '200 + expected markup'
})

for (const [path, needle] of [
  ['/competitions', 'Competitions'],
  ['/teams', 'Teams'],
  ['/news', 'Newsroom'],
  ['/medals', 'Medal'],
  ['/onboarding', 'How Obsidian Elite works'],
  ['/login', 'Sign in'],
]) {
  await check(`${path} renders`, async () => {
    const response = await get(path)
    expectStatus(response, 200, `GET ${path}`)
    const body = await response.text()
    expectContains(body, needle, `GET ${path}`)
    return '200 + expected markup'
  })
}

await check('/admin is protected', async () => {
  const response = await get('/admin')
  expectStatus(response, [200, 307, 308], 'GET /admin')
  if (response.status >= 300) {
    const location = response.headers.get('location') ?? ''
    if (!location.includes('/login')) {
      throw new Error(`expected a redirect to /login, got "${location}"`)
    }
    return `redirected to ${location}`
  }
  const body = await response.text()
  expectContains(body, 'Sign in', 'GET /admin')
  return '200 (sign-in gate rendered)'
})

await check('/api/admin-auth-info answers with no-store', async () => {
  const response = await get('/api/admin-auth-info')
  expectStatus(response, 200, 'GET /api/admin-auth-info')
  const cacheControl = response.headers.get('cache-control') ?? ''
  if (!cacheControl.includes('no-store')) throw new Error(`unexpected cache-control: ${cacheControl}`)
  const payload = await response.json()
  if (payload.authenticated !== false) throw new Error('anonymous request should not be authenticated')
  return '200, anonymous, no-store'
})

await check('/api/revalidate rejects anonymous callers', async () => {
  const response = await get('/api/revalidate', { method: 'POST' })
  expectStatus(response, 403, 'POST /api/revalidate')
  return '403 for anonymous'
})

await check('security headers are present', async () => {
  const response = await get('/')
  const required = [
    'content-security-policy',
    'x-content-type-options',
    'x-frame-options',
    'referrer-policy',
    'strict-transport-security',
  ]
  const missing = required.filter((header) => !response.headers.get(header))
  if (missing.length > 0) throw new Error(`missing headers: ${missing.join(', ')}`)
  if (response.headers.get('x-powered-by')) throw new Error('x-powered-by should be disabled')
  return required.join(', ')
})

await check('robots.txt + sitemap.xml are served', async () => {
  const robots = await get('/robots.txt')
  expectStatus(robots, 200, 'GET /robots.txt')
  const robotsBody = await robots.text()
  expectContains(robotsBody, 'Disallow: /admin', 'GET /robots.txt')

  const sitemap = await get('/sitemap.xml')
  expectStatus(sitemap, 200, 'GET /sitemap.xml')
  expectContains(await sitemap.text(), '<urlset', 'GET /sitemap.xml')
  return 'ok'
})

await check('unknown route returns 404', async () => {
  const response = await get('/this-route-does-not-exist')
  expectStatus(response, 404, 'GET /this-route-does-not-exist')
  return '404'
})

const failures = results.filter((result) => !result.ok)

console.log(`\nSmoke test against ${baseUrl}\n${'='.repeat(60)}`)
for (const result of results) {
  console.log(`${result.ok ? 'PASS' : 'FAIL'}  ${result.name}${result.detail ? ` — ${result.detail}` : ''}`)
}
console.log('='.repeat(60))
console.log(`${results.length - failures.length}/${results.length} checks passed\n`)

if (failures.length > 0) process.exit(1)