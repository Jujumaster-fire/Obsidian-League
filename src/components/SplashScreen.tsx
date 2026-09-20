'use client'

import { useEffect, useState } from 'react'
import Image from 'next/image'

export default function SplashScreen() {
  const [visible, setVisible] = useState(true)
  const [progress, setProgress] = useState(0)

  useEffect(() => {
    const start = Date.now()
    const duration = 2000

    const raf = () => {
      const elapsed = Date.now() - start
      setProgress(Math.min(elapsed / duration, 1))
      if (elapsed < duration) {
        requestAnimationFrame(raf)
      }
    }
    const timer = setTimeout(() => setVisible(false), duration)

    requestAnimationFrame(raf)
    return () => {
      clearTimeout(timer)
    }
  }, [])

  if (!visible) return null

  return (
    <div className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-[#0f172a]">
      {/* Logo */}
      <div className="relative w-24 h-24 mb-8">
        <Image
          src="/logo-compressed.jpeg"
          alt="Obsidian Elite logo"
          fill
          className="rounded-2xl object-cover"
          priority
        />
      </div>

      {/* App name */}
      <h1 className="text-white font-bold text-2xl tracking-tight mb-8">
        Obsidian Elite
      </h1>

      {/* Animated loading bar */}
      <div className="w-48 h-1 bg-white/10 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full bg-indigo-500 transition-none"
          style={{ width: `${progress * 100}%` }}
        />
      </div>
    </div>
  )
}
