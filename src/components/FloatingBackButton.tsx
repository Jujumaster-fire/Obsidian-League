'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

/**
 * Floating quick-exit button for public pages.
 *
 * It always links to the homepage (never `router.back()`), so the icon is a
 * home glyph rather than a back arrow — the arrow would promise browser
 * history navigation that this button does not perform.
 */
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
        aria-label="Return to homepage"
    >
      {/* Home icon: the button always navigates to "/", it never pops history */}
      <svg className="w-6 h-6 transform group-hover:scale-110 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M3 10.5 12 3l9 7.5M5 9.5V21h5v-6h4v6h5V9.5" />
      </svg>
    </Link>
  )
}
