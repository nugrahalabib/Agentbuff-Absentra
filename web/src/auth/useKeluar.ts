/** Keluar dari akun. Satu tempat untuk menu samping dan halaman Akun. */
import { useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '@/lib/api/client'
import { toast } from '@/components/Toast'
import { pesanGalat } from '@/lib/galat'

export function useKeluar() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  return useCallback(async () => {
    try {
      await api.signout()
    } catch (e) {
      // Sesi yang sudah habis = sudah keluar. Selain itu sesi masih hidup: jangan pura-pura keluar.
      if (!(e instanceof ApiError && e.status === 401)) {
        toast.galat(pesanGalat(e, 'Belum bisa keluar. Coba lagi.'))
        return
      }
    }
    if (api.antreanSaya().length) toast.berhasil('Absen yang tertunda tetap tersimpan di HP ini dan terkirim saat kamu masuk lagi.')
    qc.clear()
    navigate('/', { replace: true })
  }, [qc, navigate])
}
