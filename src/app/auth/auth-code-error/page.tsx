import Link from 'next/link'

// Rendered when `src/app/auth/callback/route.ts` redirects to
// `/auth/auth-code-error` (missing/invalid code or failed code exchange).
export default function AuthCodeErrorPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0f172a] px-4 py-12">
      <div className="w-full max-w-md rounded-xl border border-white/5 bg-[#1e293b] p-8 text-center">
        <h1 className="text-2xl font-bold text-white">
          Could not sign you in
        </h1>
        <p className="mt-2 text-sm text-gray-400">
          The sign-in link was invalid or has expired. Please try signing in
          again.
        </p>
        <div className="mt-6 flex items-center justify-center gap-3">
          <Link
            href="/login"
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500"
          >
            Back to sign in
          </Link>
          <Link
            href="/"
            className="rounded-md px-4 py-2 text-sm font-semibold text-gray-300 ring-1 ring-inset ring-white/10 hover:bg-white/5"
          >
            Return Home
          </Link>
        </div>
      </div>
    </div>
  )
}
