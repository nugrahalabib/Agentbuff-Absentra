/** Local UI prefs only (theme). Auth/tenant state is server-driven via /api/auth/me. */
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface UiState {
  theme: 'light' | 'dark'
  toggleTheme: () => void
}

export const useSession = create<UiState>()(
  persist(
    (set) => ({
      theme: 'light',
      toggleTheme: () => set((s) => ({ theme: s.theme === 'light' ? 'dark' : 'light' })),
    }),
    { name: 'absentra_ui_v1' },
  ),
)
