import type { Metadata } from 'next'
import './globals.css'
import ThemeToggle from '@/components/ThemeToggle'

export const metadata: Metadata = {
  title: 'Molecule Enrollment',
  description: 'Product-linked enrollment forms, payments, and records.',
}

// Runs before paint: apply the OS light preference so there is no dark→light flash.
const themeScript = `(function(){try{if(window.matchMedia&&window.matchMedia('(prefers-color-scheme: light)').matches){document.documentElement.classList.add('light')}}catch(e){}})()`

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-screen bg-bg text-text antialiased">
        <ThemeToggle />
        {children}
      </body>
    </html>
  )
}
