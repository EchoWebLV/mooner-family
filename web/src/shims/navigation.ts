// next/navigation on react-router.
import { useMemo } from 'react'
import { useLocation, useNavigate, useParams as useRouterParams, useSearchParams as useRouterSearch } from 'react-router-dom'

export function useRouter() {
  const nav = useNavigate()
  return useMemo(
    () => ({
      push: (href: string) => nav(href),
      replace: (href: string) => nav(href, { replace: true }),
      back: () => nav(-1),
      forward: () => nav(1),
      refresh: () => {},
      prefetch: () => {},
    }),
    [nav],
  )
}

export function usePathname(): string {
  return useLocation().pathname
}

export function useParams<T extends Record<string, string>>(): T {
  return useRouterParams() as T
}

export function useSearchParams(): URLSearchParams {
  return useRouterSearch()[0]
}

export function notFound(): never {
  throw new Error('not found')
}

export function redirect(href: string): never {
  window.location.replace(href)
  throw new Error('redirecting')
}
