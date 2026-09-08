'use client'

import Link from 'next/link'
import { createClient } from '@/utils/supabase/client'
import { useEffect, useState, useRef } from 'react'
import { usePathname } from 'next/navigation'

const NavLinks = ({ pathname }: { pathname: string }) => {
  const getLinkClass = (path: string) => {
    const baseClass = "px-3 py-2 rounded-md text-base md:text-sm font-medium block md:inline-block transition-colors "
    const isActive = pathname === path || (path !== '/' && pathname.startsWith(path))
    return baseClass + (isActive ? "text-white bg-white/10" : "text-gray-300 hover:text-white hover:bg-white/5")
  }

  return (
    <>
      <Link href="/" className={getLinkClass('/')}>Home</Link>
      <Link href="/teams" className={getLinkClass('/teams')}>Teams</Link>
      <Link href="/competitions" className={getLinkClass('/competitions')}>Competitions</Link>
    </>
  )
}

export default function Navigation() {
  const [user, setUser] = useState<unknown>(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)
  const supabase = createClient()
  const pathname = usePathname()
  const prevPathname = useRef(pathname)

  useEffect(() => {
    if (prevPathname.current !== pathname) {
       setIsMobileMenuOpen(false)
       prevPathname.current = pathname
    }
  }, [pathname])

  useEffect(() => {
    const checkUser = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      setUser(session?.user ?? null)
      if (session?.user) {
        const { data } = await supabase.from('user_roles').select('role').eq('user_id', session.user.id).single()
        if (data?.role === 'admin') setIsAdmin(true)
      }
    }
    checkUser()

    const { data: authListener } = supabase.auth.onAuthStateChange((event, session) => {
        setUser(session?.user ?? null)
    })

    return () => {
      authListener.subscription.unsubscribe()
    }
  }, [supabase])

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    window.location.reload()
  }

  return (
    <>
      <nav className="fixed w-full z-50 bg-[#0f172a]/90 backdrop-blur-md border-b border-white/10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center">
              {/* Hamburger Menu Button */}
              <button
                onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
                className="md:hidden p-2 -ml-2 mr-2 text-gray-400 hover:text-white focus:outline-none"
              >
                <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  {isMobileMenuOpen ? (
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  ) : (
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                  )}
                </svg>
              </button>

              <Link href="/" className="flex-shrink-0 flex items-center gap-2">
                <div className="w-8 h-8 bg-indigo-500 rounded-lg flex items-center justify-center font-bold text-white">OE</div>
                <span className="text-white font-bold text-xl tracking-tight hidden sm:block">Obsidian Elite</span>
              </Link>

              <div className="hidden md:block ml-10">
                <div className="flex items-baseline space-x-4">
                  <NavLinks pathname={pathname} />
                </div>
              </div>
            </div>
            <div className="flex items-center gap-4">
              {user ? (
                <>
                  {isAdmin && (
                    <Link href="/admin" className={`text-sm font-medium hidden sm:block ${pathname.startsWith('/admin') ? 'text-white font-bold' : 'text-indigo-400 hover:text-indigo-300'}`}>
                      Dashboard
                    </Link>
                  )}
                  <button onClick={handleSignOut} className="text-gray-300 hover:text-white px-3 py-2 rounded-md text-sm font-medium border border-gray-600 hidden sm:block">
                    Sign Out
                  </button>
                </>
              ) : (
                <Link href="/login" className="bg-indigo-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-indigo-700 transition-colors hidden sm:block">
                  Sign In
                </Link>
              )}
            </div>
          </div>
        </div>
      </nav>

      {/* Mobile Sliding Menu Overlay */}
      <div
        className={`fixed inset-0 bg-black/50 z-40 md:hidden transition-opacity duration-300 ${isMobileMenuOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        onClick={() => setIsMobileMenuOpen(false)}
      />

      {/* Mobile Sliding Menu Panel */}
      <div
        className={`fixed inset-y-0 left-0 w-64 bg-[#1e293b] z-50 transform transition-transform duration-300 ease-in-out border-r border-white/10 flex flex-col md:hidden pt-20 pb-6 px-4 shadow-2xl ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'}`}
      >
        <div className="flex flex-col space-y-4">
          <NavLinks pathname={pathname} />
          <hr className="border-white/10 my-4" />
          {user ? (
            <>
              {isAdmin && (
                <Link href="/admin" className={`px-3 py-2 rounded-md text-base font-medium block ${pathname.startsWith('/admin') ? 'text-white bg-white/10' : 'text-indigo-400 hover:text-white hover:bg-white/5'}`}>
                  Dashboard
                </Link>
              )}
              <button onClick={handleSignOut} className="text-left text-red-400 hover:text-red-300 px-3 py-2 rounded-md text-base font-medium block w-full hover:bg-white/5">
                Sign Out
              </button>
            </>
          ) : (
            <Link href="/login" className="bg-indigo-600 text-center text-white px-4 py-3 rounded-md text-base font-medium hover:bg-indigo-700 transition-colors block w-full mt-4">
              Sign In
            </Link>
          )}
        </div>
      </div>
    </>
  )
}
