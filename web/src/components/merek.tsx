/**
 * Logo dan maskot Absentra (aset dari pemilik, 21 Okt 2026).
 * Maskot = robot Absentra berlanyard, keluarga Buff AgentBuff. Satu maskot per layar,
 * berdiri bebas tanpa bingkai, dan selalu punya FUNGSI (menyambut, memandu, menemani
 * keadaan kosong), bukan tempelan.
 */
import type { ReactNode } from 'react'

export type PoseMaskot = 'selfie' | 'peta' | 'analisis' | 'jadwal' | 'cuti' | 'pulang'

/** Tinggi tampil (px). Di bawah ~170px dipakai berkas kecil (240 px lebar). */
const TINGGI: Record<'mini' | 'kecil' | 'sedang' | 'besar' | 'hero', number> = {
  mini: 72,
  kecil: 112,
  sedang: 148,
  besar: 240,
  hero: 380,
}
const RASIO = 1060 / 1460

export function Maskot({
  pose,
  ukuran = 'sedang',
  className,
  alt = '',
  prioritas = false,
}: {
  pose: PoseMaskot
  ukuran?: keyof typeof TINGGI
  className?: string
  alt?: string
  prioritas?: boolean
}) {
  const tinggi = TINGGI[ukuran]
  const lebar = Math.round(tinggi * RASIO)
  const kecil = tinggi <= 170
  return (
    <img
      src={`/maskot/${pose}${kecil ? '-kecil' : ''}.webp`}
      width={lebar}
      height={tinggi}
      alt={alt}
      aria-hidden={alt ? undefined : true}
      decoding="async"
      loading={prioritas ? 'eager' : 'lazy'}
      {...(prioritas ? ({ fetchpriority: 'high' } as Record<string, string>) : {})}
      draggable={false}
      className={['pointer-events-none select-none object-contain', className].filter(Boolean).join(' ')}
      style={{ width: lebar, height: tinggi }}
    />
  )
}

export function LogoAbsentra({ ukuran = 32, teks = true, className }: { ukuran?: number; teks?: boolean; className?: string }) {
  const sumber = ukuran <= 48 ? 96 : 192
  return (
    <span className={['inline-flex items-center gap-2.5', className].filter(Boolean).join(' ')}>
      <img
        src={`/merek/absentra-${sumber}.webp`}
        width={ukuran}
        height={ukuran}
        alt={teks ? '' : 'Absentra'}
        decoding="async"
        className="shrink-0"
        style={{ width: ukuran, height: ukuran }}
      />
      {teks && <span className="text-[19px] font-bold tracking-[-0.03em] text-tinta">Absentra</span>}
    </span>
  )
}

export function LogoAgentBuff({ ukuran = 20 }: { ukuran?: number }) {
  return (
    <img
      src="/merek/agentbuff-core-96.webp"
      width={ukuran}
      height={ukuran}
      alt=""
      decoding="async"
      className="shrink-0 rounded-full"
      style={{ width: ukuran, height: ukuran }}
    />
  )
}

/** Gelembung bicara maskot (kaca). `arah` = sisi tempat ekor menunjuk ke maskot. */
export function Gelembung({ children, className, arah = 'kiri' }: { children: ReactNode; className?: string; arah?: 'kiri' | 'bawah' }) {
  return (
    <div className={['kaca-panel relative rounded-[22px] px-5 py-4 text-[16px] leading-snug text-tinta', className].filter(Boolean).join(' ')}>
      <span
        aria-hidden
        className={[
          'absolute h-4 w-4 rotate-45 bg-[var(--kaca-pekat)] lg:bg-[var(--kaca-panel)]',
          arah === 'kiri' ? '-left-1.5 top-7' : '-bottom-1.5 left-10',
        ].join(' ')}
        style={{ boxShadow: arah === 'kiri' ? '-1px 1px 0 var(--kaca-tepi-ubin)' : '1px 1px 0 var(--kaca-tepi-ubin)' }}
      />
      <div className="relative">{children}</div>
    </div>
  )
}
