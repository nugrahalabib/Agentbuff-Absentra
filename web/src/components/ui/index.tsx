/**
 * Komponen dasar Absentra, gaya "Inti Hidup" AgentBuff.
 * Tombol = kapsul (utama graphite, kedua kaca, aksen cyan hanya untuk absen).
 * Kartu = kaca di atas latar bercahaya. Jendela = tengah di laptop, lembar bawah di HP.
 * Sasaran sentuh minimal 44px. Status selalu pakai kata + ikon, bukan warna saja.
 */
import {
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'
import { IconX } from './icons'
import { Maskot, type PoseMaskot } from '../merek'

export function cx(...parts: Array<string | false | undefined | null>): string {
  return parts.filter(Boolean).join(' ')
}

// ---------- Tombol ----------
type Variant = 'primary' | 'aksen' | 'secondary' | 'ghost' | 'danger'
type Size = 'sm' | 'md' | 'lg'

const variantCls: Record<Variant, string> = {
  primary: 'tombol-grafit',
  aksen: 'tombol-aksen',
  secondary: 'tombol-kaca',
  ghost: 'bg-transparent text-tinta-2 hover:bg-sumur hover:text-tinta disabled:text-tinta-3',
  danger: 'bg-galat-lembut text-galat hover:brightness-95 disabled:opacity-60',
}
const sizeCls: Record<Size, string> = {
  sm: 'min-h-[40px] px-4 text-[14px]',
  md: 'min-h-[46px] px-5 text-[15px]',
  lg: 'min-h-[56px] px-6 text-[17px]',
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading,
  fullWidth,
  className,
  children,
  type = 'button',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant
  size?: Size
  loading?: boolean
  fullWidth?: boolean
}) {
  return (
    <button
      type={type}
      {...rest}
      disabled={rest.disabled || loading}
      aria-busy={loading || undefined}
      className={cx(
        'inline-flex select-none items-center justify-center gap-2 rounded-full font-semibold transition-colors',
        variantCls[variant],
        sizeCls[size],
        fullWidth && 'w-full',
        className,
      )}
    >
      {loading && <Spinner className="h-4 w-4" />}
      {children}
    </button>
  )
}

// ---------- Kartu ----------
export function Card({
  children,
  className,
  onClick,
  as = 'div',
}: {
  children: ReactNode
  className?: string
  onClick?: () => void
  as?: 'div' | 'section' | 'article'
}) {
  const kelas = cx('kaca-panel rounded-[24px] p-5', onClick && 'cursor-pointer text-left transition-transform active:scale-[0.99]', className)
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={cx(kelas, 'block w-full')}>
        {children}
      </button>
    )
  }
  const Tag = as
  return <Tag className={kelas}>{children}</Tag>
}

// ---------- Lencana status (warna + kata, tidak pernah warna saja) ----------
export type Tone = 'success' | 'warning' | 'danger' | 'neutral' | 'accent'
const toneCls: Record<Tone, string> = {
  success: 'bg-inti-lembut text-inti-teks',
  warning: 'bg-perlu-lembut text-perlu',
  danger: 'bg-galat-lembut text-galat',
  neutral: 'bg-sumur text-tinta-2',
  accent: 'bg-aksen-lembut text-aksen-teks',
}
export function Badge({ tone = 'neutral', children, icon }: { tone?: Tone; children: ReactNode; icon?: ReactNode }) {
  return (
    <span className={cx('inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-0.5 text-[12px] font-semibold', toneCls[tone])}>
      {icon}
      {children}
    </span>
  )
}

// ---------- Isian ----------
export function Field({
  label,
  error,
  helper,
  children,
  htmlFor,
  className,
}: {
  label: string
  error?: string | null
  helper?: ReactNode
  children: ReactNode
  htmlFor?: string
  className?: string
}) {
  return (
    <label className={cx('block min-w-0 flex-1', className)} htmlFor={htmlFor}>
      <span className="mb-1.5 block text-[14px] font-medium text-tinta-2">{label}</span>
      {children}
      {helper && !error && <span className="mt-1.5 block text-[13px] text-tinta-3">{helper}</span>}
      {error && (
        <span className="mt-1.5 block text-[13px] font-medium text-galat" aria-live="polite">
          {error}
        </span>
      )}
    </label>
  )
}

const isianCls = 'min-h-[48px] w-full rounded-2xl px-4 text-[16px] text-tinta'

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cx(isianCls, props.className)} />
}

type PropsAngka = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type' | 'min' | 'max'> & {
  nilai: number
  onNilai: (n: number) => void
  /** Tampilkan "Rp" dan titik ribuan (1.500.000) supaya nol tidak salah hitung. */
  rupiah?: boolean
  min?: number
  max?: number
}
const titikRibuan = new Intl.NumberFormat('id-ID')
/**
 * Isian angka yang bisa dikosongkan saat mengetik (input number biasa memaksa "0" muncul
 * lagi) dan menerima tempelan seperti "Rp 1.500.000". Batas min/max diterapkan saat selesai.
 */
export function InputAngka({ nilai, onNilai, rupiah, min, max, className, onBlur, ...rest }: PropsAngka) {
  const tampil = (n: number) => (rupiah ? titikRibuan.format(n) : String(n))
  const [teks, setTeks] = useState(() => tampil(nilai))
  const [nilaiLalu, setNilaiLalu] = useState(nilai)
  if (nilai !== nilaiLalu) {
    setNilaiLalu(nilai)
    const sekarang = Number(teks.replace(/\D/g, '') || '0')
    if (sekarang !== nilai) setTeks(tampil(nilai))
  }
  const isian = (
    <input
      {...rest}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      value={teks}
      onChange={(e) => {
        const digit = e.target.value.replace(/\D/g, '').replace(/^0+(?=\d)/, '').slice(0, 13)
        const n = digit ? Number(digit) : 0
        setTeks(digit ? (rupiah ? titikRibuan.format(n) : digit) : '')
        setNilaiLalu(n)
        onNilai(n)
      }}
      onBlur={(e) => {
        let n = nilai
        if (min != null && n < min) n = min
        if (max != null && n > max) n = max
        if (n !== nilai) onNilai(n)
        setTeks(tampil(n))
        setNilaiLalu(n)
        onBlur?.(e)
      }}
      className={cx(isianCls, 'tabular-nums', rupiah && 'pl-11', className)}
    />
  )
  if (!rupiah) return isian
  return (
    <span className="relative block">
      <span aria-hidden className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[16px] text-tinta-3">Rp</span>
      {isian}
    </span>
  )
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement> & { children: ReactNode }) {
  return (
    <select {...rest} className={cx(isianCls, 'cursor-pointer', className)}>
      {children}
    </select>
  )
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cx('w-full rounded-2xl px-4 py-3 text-[16px] text-tinta', props.className)} />
}

/** Saklar nyala/mati gaya iOS. */
export function Saklar({
  checked,
  onChange,
  label,
  keterangan,
  disabled,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
  keterangan?: string
  disabled?: boolean
}) {
  const id = useId()
  return (
    <div className="flex items-start justify-between gap-4">
      <label htmlFor={id} className="min-w-0 cursor-pointer">
        <span className="block text-[15px] font-medium text-tinta">{label}</span>
        {keterangan && <span className="mt-0.5 block text-[13px] text-tinta-3">{keterangan}</span>}
      </label>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cx(
          'relative mt-0.5 h-[30px] w-[50px] shrink-0 rounded-full transition-colors disabled:opacity-50',
          checked ? 'bg-grafit' : 'bg-sumur',
        )}
      >
        <span
          className={cx(
            'absolute top-[3px] h-6 w-6 rounded-full bg-[#fff] shadow-[0_2px_6px_rgba(0,0,0,0.25)] transition-transform',
            checked ? 'translate-x-[23px]' : 'translate-x-[3px]',
          )}
        />
      </button>
    </div>
  )
}

/** Kotak centang besar (persetujuan, pilih karyawan). */
export function Centang({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  return (
    <label className="flex min-h-[44px] cursor-pointer items-start gap-3 py-2 text-[15px] text-tinta">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 h-5 w-5 shrink-0" />
      <span className="min-w-0">{children}</span>
    </label>
  )
}

/** Segmen pilihan (tab kecil). */
export function Segmen<T extends string>({
  nilai,
  pilihan,
  onChange,
  label,
  className,
}: {
  nilai: T
  pilihan: { nilai: T; label: string }[]
  onChange: (v: T) => void
  label: string
  className?: string
}) {
  return (
    <div role="tablist" aria-label={label} className={cx('inline-flex w-full gap-1 rounded-full bg-sumur p-1 sm:w-auto', className)}>
      {pilihan.map((p) => (
        <button
          key={p.nilai}
          type="button"
          role="tab"
          aria-selected={nilai === p.nilai}
          onClick={() => onChange(p.nilai)}
          className={cx(
            'min-h-[40px] flex-1 whitespace-nowrap rounded-full px-4 text-[14px] font-semibold transition-colors sm:flex-none',
            nilai === p.nilai ? 'bg-permukaan text-tinta shadow-lembut' : 'text-tinta-2 hover:text-tinta',
          )}
        >
          {p.label}
        </button>
      ))}
    </div>
  )
}

// ---------- Jendela: tengah di laptop, lembar bawah di HP ----------
export function BottomSheet({
  open,
  onClose,
  title,
  keterangan,
  children,
  lebar = 'md',
}: {
  open: boolean
  onClose: () => void
  title?: string
  keterangan?: string
  children: ReactNode
  lebar?: 'md' | 'lg'
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  const tutupRef = useRef(onClose)
  tutupRef.current = onClose

  useEffect(() => {
    if (!open) return
    const sebelumnya = document.activeElement as HTMLElement | null
    const overflowLama = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        tutupRef.current()
        return
      }
      if (e.key !== 'Tab' || !panelRef.current) return
      const fokus = panelRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])',
      )
      if (!fokus.length) return
      const awal = fokus[0]
      const akhir = fokus[fokus.length - 1]
      if (e.shiftKey && document.activeElement === awal) {
        e.preventDefault()
        akhir.focus()
      } else if (!e.shiftKey && document.activeElement === akhir) {
        e.preventDefault()
        awal.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    requestAnimationFrame(() => panelRef.current?.focus())
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = overflowLama
      sebelumnya?.focus?.()
    }
  }, [open])

  if (!open) return null
  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-end justify-center lg:items-center lg:p-6" role="dialog" aria-modal="true" aria-label={title}>
      <div className="anim-muncul absolute inset-0 bg-[var(--tirai)]" onClick={onClose} />
      <div
        ref={panelRef}
        tabIndex={-1}
        className={cx(
          'kaca-jendela anim-lapisan relative z-10 flex max-h-[92dvh] w-full flex-col rounded-t-[28px] outline-none lg:rounded-[28px]',
          lebar === 'lg' ? 'lg:max-w-2xl' : 'lg:max-w-lg',
        )}
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div className="mx-auto mt-2.5 h-1.5 w-10 shrink-0 rounded-full bg-garis lg:hidden" />
        {title && (
          <div className="flex shrink-0 items-start justify-between gap-3 px-6 pb-2 pt-4 lg:pt-6">
            <div className="min-w-0">
              <h2 className="text-[20px] font-bold tracking-[-0.02em] text-tinta">{title}</h2>
              {keterangan && <p className="mt-1 text-[14px] text-tinta-3">{keterangan}</p>}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Tutup"
              className="-mr-2 flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-tinta-2 hover:bg-sumur"
            >
              <IconX width={20} height={20} />
            </button>
          </div>
        )}
        <div className="min-h-0 overflow-y-auto px-6 pb-6 pt-2">{children}</div>
      </div>
    </div>,
    document.body,
  )
}

// ---------- Pemuat ----------
export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={cx('animate-spin', className)} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle className="opacity-20" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3.5" />
      <path className="opacity-90" d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" />
    </svg>
  )
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx('animate-pulse rounded-2xl bg-sumur', className)} />
}

// ---------- Keadaan kosong ----------
export function EmptyState({
  title,
  keterangan,
  action,
  pose,
}: {
  title: string
  keterangan?: string
  action?: ReactNode
  pose?: PoseMaskot
}) {
  return (
    <div className="kaca-panel flex flex-col items-center gap-2 rounded-[24px] px-6 py-8 text-center">
      {pose && <Maskot pose={pose} ukuran="sedang" className="mb-1" />}
      <p className="text-[17px] font-semibold text-tinta">{title}</p>
      {keterangan && <p className="max-w-sm text-[14px] text-tinta-3">{keterangan}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  )
}

// ---------- Kepala halaman ----------
export function KepalaHalaman({
  judul,
  keterangan,
  aksi,
  atas,
}: {
  judul: string
  keterangan?: ReactNode
  aksi?: ReactNode
  atas?: ReactNode
}) {
  return (
    <header className="mb-5 flex flex-wrap items-end justify-between gap-x-4 gap-y-3 lg:mb-7">
      <div className="min-w-0">
        {atas && <p className="mb-1 text-[14px] font-medium text-tinta-3">{atas}</p>}
        <h1 className="text-[28px] font-bold leading-[1.1] tracking-[-0.03em] text-tinta lg:text-[34px]">{judul}</h1>
        {keterangan && <p className="mt-1.5 max-w-xl text-[15px] text-tinta-2">{keterangan}</p>}
      </div>
      {aksi && <div className="flex flex-wrap items-center gap-2">{aksi}</div>}
    </header>
  )
}

/** Pesan galat sebaris (dipakai formulir). */
export function PesanGalat({ children }: { children: ReactNode }) {
  if (!children) return null
  return (
    <p className="rounded-2xl bg-galat-lembut px-4 py-3 text-[14px] font-medium text-galat" role="alert">
      {children}
    </p>
  )
}

/** Catatan info lembut (amber = perlu perhatian, aksen = info merek). */
export function Catatan({ children, nada = 'netral' }: { children: ReactNode; nada?: 'netral' | 'perlu' | 'hidup' }) {
  const kelas =
    nada === 'perlu' ? 'bg-perlu-lembut text-perlu' : nada === 'hidup' ? 'bg-inti-lembut text-inti-teks' : 'bg-sumur text-tinta-2'
  return <div className={cx('rounded-2xl px-4 py-3 text-[14px]', kelas)}>{children}</div>
}
