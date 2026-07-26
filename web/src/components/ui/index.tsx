/** Absentra UI primitives — see docs/design-system.md §6. Touch ≥44px, semantic
 * colors, status always paired with text/icon, accessible focus. */
import { type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, useEffect, useRef } from 'react'

function cx(...parts: Array<string | false | undefined | null>): string {
  return parts.filter(Boolean).join(' ')
}

// ---------- Button ----------
type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
type Size = 'sm' | 'md' | 'lg'

const variantCls: Record<Variant, string> = {
  primary: 'bg-primary text-on-primary hover:bg-primary-pressed active:bg-primary-pressed',
  secondary: 'bg-surface-elevated text-text border border-border hover:bg-surface',
  ghost: 'bg-transparent text-text hover:bg-surface',
  danger: 'bg-danger text-white hover:opacity-90',
}
const sizeCls: Record<Size, string> = {
  sm: 'min-h-touch px-3 text-sm',
  md: 'min-h-touch px-4 text-base',
  lg: 'min-h-[52px] px-5 text-lg',
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading,
  fullWidth,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant
  size?: Size
  loading?: boolean
  fullWidth?: boolean
}) {
  return (
    <button
      {...rest}
      disabled={rest.disabled || loading}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-md font-semibold transition-colors duration-150 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed',
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

// ---------- Card ----------
export function Card({ children, className, onClick }: { children: ReactNode; className?: string; onClick?: () => void }) {
  return (
    <div
      onClick={onClick}
      className={cx(
        'rounded-lg border border-border bg-surface-elevated p-4 shadow-sm',
        onClick && 'cursor-pointer hover:border-primary transition-colors',
        className,
      )}
    >
      {children}
    </div>
  )
}

// ---------- Badge (status — color + label, never color alone) ----------
type Tone = 'success' | 'warning' | 'danger' | 'neutral' | 'accent'
const toneCls: Record<Tone, string> = {
  success: 'bg-success/10 text-success',
  warning: 'bg-warning/10 text-warning',
  danger: 'bg-danger/10 text-danger',
  neutral: 'bg-text-muted/10 text-text-muted',
  accent: 'bg-accent/10 text-accent',
}
export function Badge({ tone = 'neutral', children, icon }: { tone?: Tone; children: ReactNode; icon?: ReactNode }) {
  return (
    <span className={cx('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium', toneCls[tone])}>
      {icon}
      {children}
    </span>
  )
}

// ---------- Input / Field ----------
export function Field({
  label,
  error,
  helper,
  children,
  htmlFor,
}: {
  label: string
  error?: string
  helper?: string
  children: ReactNode
  htmlFor?: string
}) {
  return (
    <label className="block" htmlFor={htmlFor}>
      <span className="mb-1 block text-sm font-medium text-text">{label}</span>
      {children}
      {helper && !error && <span className="mt-1 block text-xs text-text-muted">{helper}</span>}
      {error && (
        <span className="mt-1 block text-xs text-danger" aria-live="polite">
          {error}
        </span>
      )}
    </label>
  )
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={cx(
        'min-h-touch w-full rounded-md border border-border bg-surface-elevated px-3 text-base text-text outline-none focus:border-primary',
        props.className,
      )}
    />
  )
}

export function Select(props: InputHTMLAttributes<HTMLSelectElement> & { children: ReactNode }) {
  const { children, className, ...rest } = props as any
  return (
    <select
      {...rest}
      className={cx(
        'min-h-touch w-full rounded-md border border-border bg-surface-elevated px-3 text-base text-text outline-none focus:border-primary',
        className,
      )}
    >
      {children}
    </select>
  )
}

// ---------- Bottom sheet / Modal ----------
export function BottomSheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title?: string; children: ReactNode }) {
  const panelRef = useRef<HTMLDivElement>(null)
  const prevFocus = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!open) return
    prevFocus.current = document.activeElement as HTMLElement | null
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return }
      if (e.key !== 'Tab' || !panelRef.current) return
      const focusable = panelRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])',
      )
      if (!focusable.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
    }
    window.addEventListener('keydown', onKey)
    // Focus first interactive / panel
    requestAnimationFrame(() => {
      const first = panelRef.current?.querySelector<HTMLElement>('button, input, select, textarea, a[href]')
      ;(first ?? panelRef.current)?.focus()
    })
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
      prevFocus.current?.focus?.()
    }
  }, [open, onClose])

  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-black/40 animate-fade-in" onClick={onClose} />
      <div
        ref={panelRef}
        tabIndex={-1}
        className="relative z-10 max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-lg bg-surface-elevated p-5 shadow-lg animate-sheet-up sm:rounded-lg"
      >
        <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-border sm:hidden" />
        {title && <h2 className="mb-3 text-lg font-semibold text-text">{title}</h2>}
        {children}
      </div>
    </div>
  )
}

// ---------- Spinner / Skeleton ----------
export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={cx('animate-spin', className)} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle className="opacity-20" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-90" d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
    </svg>
  )
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx('animate-pulse rounded-md bg-border/60', className)} />
}

// ---------- Empty state ----------
export function EmptyState({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border p-8 text-center text-text-muted">
      <p>{title}</p>
      {action}
    </div>
  )
}

export { cx }
