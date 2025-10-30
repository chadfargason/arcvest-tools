import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'ArcVest - Investment Portfolio Tools',
  description: 'Professional investment portfolio tools and advisory services powered by advanced analytics',
  keywords: ['investment', 'portfolio', 'calculator', 'financial planning', 'advisory'],
  authors: [{ name: 'ArcVest' }],
  viewport: 'width=device-width, initial-scale=1',
  robots: 'index, follow',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className="dark">
      <body className="antialiased">
        {children}
      </body>
    </html>
  )
}
