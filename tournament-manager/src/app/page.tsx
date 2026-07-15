import Link from 'next/link'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export default async function Home() {
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()

  let isAdmin = false;
  if (user) {
      const { data } = await supabase.from('user_roles').select('role').eq('user_id', user.id).single();
      isAdmin = data?.role === 'admin';
  }

  // Fetch some public data to prove it works
  const { data: fixtures } = await supabase.from('fixtures').select('*, home_team:teams!home_team_id(name), away_team:teams!away_team_id(name)').limit(5);

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center py-20 px-4 font-sans text-gray-900">
      <h1 className="text-4xl font-bold tracking-tight text-center mb-8">Obsidian Elite Tournament Manager</h1>

      <div className="flex gap-4 mb-12">
        {user ? (
          <div className="flex gap-4 items-center">
            <span className="text-gray-600">Signed in as {user.email}</span>
            {isAdmin && (
              <Link href="/admin" className="bg-indigo-600 text-white px-4 py-2 rounded-md hover:bg-indigo-700 font-medium">
                Go to Admin Dashboard
              </Link>
            )}
            <form action="/auth/signout" method="post">
              <button className="bg-white border border-gray-300 text-gray-700 px-4 py-2 rounded-md hover:bg-gray-50 font-medium">
                Sign out
              </button>
            </form>
          </div>
        ) : (
          <Link href="/login" className="bg-indigo-600 text-white px-6 py-3 rounded-md hover:bg-indigo-700 font-medium text-lg">
            Sign In / Sign Up
          </Link>
        )}
      </div>

      <div className="w-full max-w-2xl bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <h2 className="text-2xl font-semibold mb-4">Latest Fixtures</h2>
        {fixtures && fixtures.length > 0 ? (
          <ul className="divide-y divide-gray-200">
            {fixtures.map((f) => (
              <li key={f.id} className="py-4 flex justify-between">
                <div>
                  <span className="font-medium">{f.home_team.name}</span> vs <span className="font-medium">{f.away_team.name}</span>
                </div>
                <div className="text-gray-500 text-sm">
                  {new Date(f.match_date).toLocaleDateString()} - {f.status}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-gray-500">No fixtures scheduled yet. (Admins can add them in the dashboard).</p>
        )}
      </div>
    </div>
  )
}
