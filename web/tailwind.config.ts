import type { Config } from 'tailwindcss'

// Tokens mirror docs/design-system.md. Colors reference CSS variables (defined in src/index.css)
// so light/dark mode swaps values without changing utility classes.
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: ['class', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        primary: 'var(--color-primary)',
        'primary-pressed': 'var(--color-primary-pressed)',
        'on-primary': 'var(--color-on-primary)',
        accent: 'var(--color-accent)',
        success: 'var(--color-success)',
        warning: 'var(--color-warning)',
        danger: 'var(--color-danger)',
        surface: 'var(--color-surface)',
        'surface-elevated': 'var(--color-surface-elevated)',
        text: 'var(--color-text)',
        'text-muted': 'var(--color-text-muted)',
        border: 'var(--color-border)',
      },
      borderRadius: {
        sm: '6px',
        md: '10px',
        lg: '16px',
      },
      spacing: {
        // 4px base scale (design-system.md §4)
        '4.5': '18px',
      },
      fontFamily: {
        sans: [
          '-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'Roboto',
          '"Helvetica Neue"', 'Arial', '"Noto Sans"', 'sans-serif',
        ],
        serif: ['Georgia', 'Cambria', '"Iowan Old Style"', '"Times New Roman"', 'serif'],
      },
      minHeight: { touch: '44px' },
      minWidth: { touch: '44px' },
    },
  },
  plugins: [],
} satisfies Config
