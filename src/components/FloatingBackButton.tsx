'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

export default function FloatingBackButton() {
  const pathname = usePathname()

  // Don't show on the homepage or admin dashboard
  if (pathname === '/' || pathname.startsWith('/admin')) {
    return null
  }

  return (
    <Link
        href="/"
        className="fixed bottom-6 right-6 z-40 bg-indigo-600 hover:bg-indigo-500 text-white p-4 rounded-full shadow-[0_10px_25px_rgba(79,70,229,0.5)] transition-all transform hover:scale-110 border border-indigo-400/50 backdrop-blur-md flex items-center justify-center group"
        aria-label="Return to Main Page"
    >
      <svg className="w-6 h-6 transform group-hover:-translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
      </svg>
    </Link>
  )
}
