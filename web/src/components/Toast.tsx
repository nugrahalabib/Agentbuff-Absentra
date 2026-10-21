/** Pemberitahuan singkat (kapsul graphite di bawah layar, di atas bilah tab HP). */
import { create } from 'zustand'
import { IconAlert, IconCheckCircle } from './ui/icons'

interface ItemToast {
  id: number
  pesan: string
  nada: 'berhasil' | 'galat'
}

interface StoreToast {
  daftar: ItemToast[]
  tambah: (pesan: string, nada: ItemToast['nada']) => void
  hapus: (id: number) => void
}

let urut = 0

const useToastStore = create<StoreToast>((set) => ({
  daftar: [],
  tambah: (pesan, nada) => {
    const id = ++urut
    set((s) => ({ daftar: [...s.daftar.slice(-2), { id, pesan, nada }] }))
    window.setTimeout(() => set((s) => ({ daftar: s.daftar.filter((t) => t.id !== id) })), nada === 'galat' ? 5200 : 3200)
  },
  hapus: (id) => set((s) => ({ daftar: s.daftar.filter((t) => t.id !== id) })),
}))

export const toast = {
  berhasil: (pesan: string) => useToastStore.getState().tambah(pesan, 'berhasil'),
  galat: (pesan: string) => useToastStore.getState().tambah(pesan, 'galat'),
}

export function Toaster() {
  const daftar = useToastStore((s) => s.daftar)
  const hapus = useToastStore((s) => s.hapus)
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 z-[90] flex flex-col items-center gap-2 px-4"
      style={{ bottom: 'calc(env(safe-area-inset-bottom) + 88px)' }}
    >
      {daftar.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => hapus(t.id)}
          className="anim-naik pointer-events-auto flex max-w-md items-center gap-2.5 rounded-full bg-grafit px-5 py-3 text-left text-[14px] font-medium text-grafit-teks shadow-[0_18px_40px_-14px_rgba(0,0,0,0.55)]"
        >
          {t.nada === 'galat' ? (
            <IconAlert width={18} height={18} className="shrink-0 text-[#f59e8b]" />
          ) : (
            <IconCheckCircle width={18} height={18} className="shrink-0 text-aksen" />
          )}
          {t.pesan}
        </button>
      ))}
    </div>
  )
}
