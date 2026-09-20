import type { Metadata } from 'next'
import Navigation from '@/components/Navigation'
import { OnboardingGuide } from './OnboardingGuide'

export const metadata: Metadata = {
  title: 'Guide | Obsidian Elite',
  description:
    'Every feature of Obsidian Elite, explained for fans, users, scouts, tournament admins and app admins — plus a guided tour of the live controls.',
  openGraph: {
    title: 'Guide | Obsidian Elite',
    description:
      'Every feature of Obsidian Elite, explained for fans, users, scouts, tournament admins and app admins — plus a guided tour of the live controls.',
    siteName: 'Obsidian Elite',
    type: 'website',
  },
}

export default function OnboardingPage() {
  return (
    <div className="min-h-screen bg-[#0f172a] text-white pb-32">
      <Navigation />

      <div className="pt-24 px-4 sm:px-6 lg:px-8 max-w-6xl mx-auto">
        <header className="mb-10 text-center md:text-left">
          <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight mb-2">
            How Obsidian Elite works
          </h1>
          <p className="text-gray-400 max-w-3xl text-lg">
            One page for every level of user — what each control does, where to find
            it, and what you need before it unlocks. Pick your role, then take the
            guided tour of the real components.
          </p>
        </header>

        <OnboardingGuide />
      </div>
    </div>
  )
}
