// next/link on react-router: the wireframe's components keep their imports.
import { forwardRef, type AnchorHTMLAttributes } from 'react'
import { Link as RouterLink } from 'react-router-dom'

type Props = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & {
  href: string | { pathname?: string; query?: Record<string, string> }
  prefetch?: boolean
  replace?: boolean
  scroll?: boolean
}

const Link = forwardRef<HTMLAnchorElement, Props>(function Link({ href, prefetch, replace, scroll, ...rest }, ref) {
  void prefetch
  void scroll
  const to = typeof href === 'string' ? href : `${href.pathname ?? ''}${href.query ? '?' + new URLSearchParams(href.query) : ''}`
  if (/^(https?:|mailto:)/.test(to)) return <a ref={ref} href={to} {...rest} />
  return <RouterLink ref={ref} to={to} replace={replace} {...rest} />
})

export default Link
