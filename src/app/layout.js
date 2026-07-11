import './globals.css'
import { AuthProvider } from '@/context/AuthContext'
import { FirestoreDataProvider } from '@/context/FirestoreDataContext'

export const metadata = {
  title: {
    default: 'Cedar Grove Analytics',
    template: '%s — Cedar Grove Analytics',
  },
  description: 'Attorney time allocation and efficiency insights',
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        {/* Bypass block (WCAG 2.4.1): first focusable element on every page.
            #main-content lives on each page's <main> landmark. */}
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:px-4 focus:py-2 focus:bg-white focus:text-cg-dark focus:rounded-lg focus:shadow-lg"
        >
          Skip to main content
        </a>
        <AuthProvider>
          <FirestoreDataProvider>
            {children}
          </FirestoreDataProvider>
        </AuthProvider>
      </body>
    </html>
  )
}
