import type { Config } from 'tailwindcss';
import animate from 'tailwindcss-animate';

/** Every colour here points at a token in src/styles/tokens.css. */
const config: Config = {
  darkMode: ['selector', ':root:not([data-theme="light"])'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        background: 'hsl(var(--background))',
        surface: {
          DEFAULT: 'hsl(var(--surface))',
          raised: 'hsl(var(--surface-raised))',
        },
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        foreground: 'hsl(var(--foreground))',
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        highlight: 'hsl(var(--highlight))',
        success: 'hsl(var(--success))',
        warning: 'hsl(var(--warning))',
        danger: 'hsl(var(--danger))',
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        display: ['"Space Grotesk"', 'Inter', 'ui-sans-serif', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      fontSize: {
        // Display sizes for headings; body sizes stay on Tailwind's scale.
        'display-sm': ['1.75rem', { lineHeight: '1.15', letterSpacing: '-0.02em', fontWeight: '600' }],
        'display-md': ['2.5rem', { lineHeight: '1.08', letterSpacing: '-0.03em', fontWeight: '600' }],
        'display-lg': ['3.5rem', { lineHeight: '1.02', letterSpacing: '-0.035em', fontWeight: '700' }],
        'display-xl': ['4.75rem', { lineHeight: '0.98', letterSpacing: '-0.04em', fontWeight: '700' }],
      },
      borderRadius: {
        sm: 'var(--radius-sm)',
        DEFAULT: 'var(--radius)',
        md: 'var(--radius)',
        lg: 'var(--radius-lg)',
        xl: 'var(--radius-xl)',
      },
      boxShadow: {
        soft: 'var(--shadow-soft)',
        raised: 'var(--shadow-raised)',
        glow: 'var(--shadow-glow)',
      },
      spacing: {
        // Page gutters and the fixed nav height, so layouts never guess.
        gutter: '1rem',
        'gutter-lg': '2rem',
        nav: '4rem',
      },
      maxWidth: {
        page: '80rem',
      },
      keyframes: {
        'fade-up': {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        shimmer: {
          '100%': { transform: 'translateX(100%)' },
        },
        'pulse-ring': {
          '0%': { opacity: '0.6', transform: 'scale(0.95)' },
          '70%, 100%': { opacity: '0', transform: 'scale(1.25)' },
        },
      },
      animation: {
        'fade-up': 'fade-up 0.4s ease-out both',
        shimmer: 'shimmer 1.6s infinite',
        'pulse-ring': 'pulse-ring 2s ease-out infinite',
      },
    },
  },
  plugins: [animate],
};

export default config;
