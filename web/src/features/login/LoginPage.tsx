import { Navigate, useSearchParams } from 'react-router-dom'

/** Deep-link /login → landing popup. Preserves OAuth error query. */
export function LoginPage() {
  const [params] = useSearchParams()
  const err = params.get('error')
  const to = err ? `/?auth=login&error=${encodeURIComponent(err)}` : '/?auth=login'
  return <Navigate to={to} replace />
}
