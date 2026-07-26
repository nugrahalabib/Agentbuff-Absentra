/** Resolves the signed-in user, active tenant membership, and employee context
 * from the server session (GET /api/auth/me). Single source of auth truth. */
import { useQuery } from '@tanstack/react-query'
import { api, ApiError } from '@/lib/api/client'
import type { Actor } from '@/lib/domain/rbac'

export function useActor() {
  const query = useQuery({
    queryKey: ['me'],
    retry: false,
    staleTime: 10_000,
    queryFn: async () => {
      try {
        return await api.me()
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null
        throw e
      }
    },
  })

  const me = query.data ?? null
  const active = me?.memberships.find((m) => m.company.id === me.activeCompanyId) ?? null
  const membership = active?.membership ?? null
  const company = active?.company ?? null
  const employeeId = me?.employeeId ?? null
  const actor: Actor | null = membership ? { membership, employeeId: employeeId ?? undefined } : null

  return {
    ...query,
    isSignedIn: !!me,
    user: me?.user ?? null,
    memberships: me?.memberships ?? [],
    activeCompanyId: me?.activeCompanyId ?? null,
    company,
    membership,
    employee: employeeId ? { id: employeeId } : null,
    employeeId,
    actor,
    role: membership?.role ?? null,
    scopeBranchIds: membership?.scopeBranchIds ?? [],
    hasPassword: me?.hasPassword ?? false,
    passwordAuthAllowed: me?.passwordAuthAllowed ?? false,
  }
}
