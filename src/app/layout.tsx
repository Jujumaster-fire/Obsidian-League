import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import FloatingBackButton from '@/components/FloatingBackButton'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'Obsidian Elite Tournament Manager',
  description: 'Manage tournaments and track live match stats.',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className={inter.className}>
        {children}
        <FloatingBackButton />
      </body>
    </html>
  )
}
