import Link from 'next/link'

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0f172a] px-4 py-12">
      <div className="w-full max-w-md rounded-xl border border-white/5 bg-[#1e293b] p-8 text-center">
        <p className="text-sm font-semibold uppercase tracking-widest text-indigo-400">
          404
        </p>
        <h1 className="mt-2 text-2xl font-bold text-white">
          Page not found
        </h1>
        <p className="mt-2 text-sm text-gray-400">
          Could not find the requested resource.
        </p>
        <Link
          href="/"
          className="mt-6 inline-block rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500"
        >
          Return Home
        </Link>
      </div>
    </div>
  )
}
