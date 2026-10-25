import { HeadContent, Outlet, Scripts, createRootRoute } from '@tanstack/react-router'
/// <reference types="vite/client" />
import type { ReactNode } from 'react'
import { Toaster } from '~/components/ui/sonner'
import appCss from '~/styles/app.css?url'

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
    ],
    links: [{ rel: 'stylesheet', href: appCss }],
  }),
  component: RootComponent,
  notFoundComponent: NotFoundPage,
})

function RootComponent() {
  return (
    <RootDocument>
      <Outlet />
    </RootDocument>
  )
}

function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body className="min-h-dvh antialiased">
        {children}
        <Toaster />
        <Scripts />
      </body>
    </html>
  )
}

function NotFoundPage() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="text-sm font-medium text-muted-foreground">404</p>
      <h1 className="text-3xl font-bold tracking-tight">Page not found</h1>
      <p className="text-muted-foreground">
        The page you are looking for does not exist or has been moved.
      </p>
      <a
        href="/"
        className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
      >
        Back to home
      </a>
    </main>
  )
}
