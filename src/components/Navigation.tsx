'use client'

import Link from 'next/link'
import { createClient } from '@/utils/supabase/client'
import { useEffect, useState } from 'react'

export default function Navigation() {
  const [user, setUser] = useState<any>(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const supabase = createClient()

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
    <nav className="fixed w-full z-50 bg-[#0f172a]/90 backdrop-blur-md border-b border-white/10">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          <div className="flex items-center">
            <Link href="/" className="flex-shrink-0 flex items-center gap-2">
              <div className="w-8 h-8 bg-indigo-500 rounded-lg flex items-center justify-center font-bold text-white">OE</div>
              <span className="text-white font-bold text-xl tracking-tight hidden sm:block">Obsidian Elite</span>
            </Link>
            <div className="hidden md:block ml-10">
              <div className="flex items-baseline space-x-4">
                <Link href="/" className="text-gray-300 hover:text-white px-3 py-2 rounded-md text-sm font-medium">Home</Link>
                <Link href="/team/demo" className="text-gray-300 hover:text-white px-3 py-2 rounded-md text-sm font-medium">Teams</Link>
                <Link href="/match/demo" className="text-gray-300 hover:text-white px-3 py-2 rounded-md text-sm font-medium">Match Center</Link>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-4">
            {user ? (
              <>
                {isAdmin && (
                  <Link href="/admin" className="text-indigo-400 hover:text-indigo-300 px-3 py-2 text-sm font-medium hidden sm:block">
                    Dashboard
                  </Link>
                )}
                <button onClick={handleSignOut} className="text-gray-300 hover:text-white px-3 py-2 rounded-md text-sm font-medium border border-gray-600">
                  Sign Out
                </button>
              </>
            ) : (
              <Link href="/login" className="bg-indigo-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-indigo-700 transition-colors">
                Sign In
              </Link>
            )}
          </div>
        </div>
      </div>
    </nav>
  )
}
