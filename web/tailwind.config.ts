import type { Config } from 'tailwindcss'

/**
 * Gaya "Inti Hidup" AgentBuff (rombak Oktober 2026), diterjemahkan untuk Absentra.
 * Aturan induk: Docs/Produk/rombak-ui/PANDUAN-DESAIN.md di repo AgentBuff; ringkasan
 * khusus Absentra di docs/GAYA-TAMPILAN.md.
 *
 * Nilai warna ada di src/index.css (kanal RGB) supaya mode gelap cukup mengganti
 * variabel. Nama lama (primary, surface, text, border, ...) tetap ada dan isinya
 * dipetakan ulang, supaya halaman cetak lama tidak pecah.
 */
const v = (nama: string) => `rgb(var(--${nama}) / <alpha-value>)`
const vt = (nama: string, alfa: string) => `rgb(var(--${nama}) / calc(<alpha-value> * var(--${alfa})))`

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: ['class', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        // Inti Hidup
        kanvas: { DEFAULT: v('kanvas'), 2: v('kanvas-2') },
        permukaan: vt('permukaan', 'permukaan-a'),
        sumur: vt('sumur', 'sumur-a'),
        tinta: { DEFAULT: v('tinta'), 2: v('tinta-2'), 3: v('tinta-3') },
        grafit: { DEFAULT: v('grafit'), teks: v('grafit-teks') },
        hitam: v('hitam'),
        inti: { DEFAULT: v('inti'), teks: v('inti-teks'), lembut: v('inti-lembut') },
        perlu: { DEFAULT: v('perlu'), lembut: v('perlu-lembut') },
        galat: { DEFAULT: v('galat'), lembut: v('galat-lembut') },
        garis: vt('garis', 'garis-a'),
        // Aksen khas Absentra: cyan "lencana hadir" dari logo. Sedikit saja.
        aksen: { DEFAULT: v('aksen'), terang: v('aksen-terang'), lembut: v('aksen-lembut'), teks: v('aksen-teks'), isi: v('aksen-isi') },

        // Nama lama, dipetakan ke Inti Hidup.
        primary: v('grafit'),
        'primary-pressed': v('hitam'),
        'on-primary': v('grafit-teks'),
        accent: v('inti-teks'),
        success: v('inti-teks'),
        warning: v('perlu'),
        danger: v('galat'),
        surface: vt('sumur', 'sumur-a'),
        'surface-elevated': vt('permukaan', 'permukaan-a'),
        text: v('tinta'),
        'text-muted': v('tinta-2'),
        border: vt('garis', 'garis-a'),
      },
      fontFamily: {
        sans: ['"Geist Variable"', 'Geist', '-apple-system', 'system-ui', '"Segoe UI"', 'Roboto', 'sans-serif'],
        display: ['"Geist Variable"', 'Geist', '-apple-system', 'system-ui', '"Segoe UI"', 'sans-serif'],
        serif: ['"Geist Variable"', 'Geist', '-apple-system', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        sm: '8px',
        md: '12px',
        lg: '16px',
        xl: '20px',
        '2xl': '24px',
        '3xl': '28px',
      },
      boxShadow: {
        lembut: '0 1px 2px rgba(24,22,18,0.04), 0 12px 32px rgba(24,22,18,0.07)',
        kaca: 'inset 0 1px 0 rgba(255,255,255,0.9), 0 24px 60px rgba(24,22,18,0.09)',
        jendela: 'inset 0 1px 0 rgba(255,255,255,0.9), 0 40px 100px -20px rgba(24,22,18,0.45)',
      },
      minHeight: { touch: '44px' },
      minWidth: { touch: '44px' },
    },
  },
  plugins: [],
} satisfies Config
