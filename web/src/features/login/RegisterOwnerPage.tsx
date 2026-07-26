import { Navigate } from 'react-router-dom'

/** Deep-link /daftar → landing popup daftar. */
export function RegisterOwnerPage() {
  return <Navigate to="/?auth=register" replace />
}
