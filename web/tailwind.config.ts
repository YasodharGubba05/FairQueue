import type { Config } from 'tailwindcss';
import animate from 'tailwindcss-animate';

/**
 * Every colour here points at a token in src/styles/tokens.css, and there is
 * deliberately no `accent`: the interface has no accent colour. If a component
 * wants to stand out it does it with size, weight or space, not hue.
 */
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
          hover: 'hsl(var(--surface-hover))',
        },
        foreground: 'hsl(var(--foreground))',
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        faint: 'hsl(var(--faint))',
        ring: 'hsl(var(--ring))',
        // Colour that means something.
        tier: {
          1: 'hsl(var(--tier-1))',
          2: 'hsl(var(--tier-2))',
          3: 'hsl(var(--tier-3))',
          4: 'hsl(var(--tier-4))',
        },
        seat: {
          held: 'hsl(var(--seat-held))',
          sold: 'hsl(var(--seat-sold))',
        },
        success: 'hsl(var(--success))',
        warning: 'hsl(var(--warning))',
        danger: 'hsl(var(--danger))',
      },
      borderColor: {
        // One hairline, white at low alpha in the dark theme and black in the
        // light one, so it sits correctly on any surface.
        DEFAULT: 'hsl(var(--line) / var(--line-alpha))',
        strong: 'hsl(var(--line) / var(--line-strong-alpha))',
      },
      fontFamily: {
        // Outfit is geometric and carries very light weights at large sizes,
        // which is what this design is built on. Inter does the small UI text,
        // where Outfit would cost legibility.
        display: ['Outfit', 'Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      fontSize: {
        // The label: 11px, uppercase, widely tracked. Used everywhere a small
        // piece of text names a large one.
        label: ['0.6875rem', { lineHeight: '1', letterSpacing: '0.22em', fontWeight: '400' }],
        // Display sizes are thin and tightly tracked. Nothing here is bold:
        // scale does the work that weight does in an ordinary interface.
        'display-sm': ['2.25rem', { lineHeight: '1.08', letterSpacing: '-0.02em', fontWeight: '300' }],
        'display-md': ['3.25rem', { lineHeight: '1.04', letterSpacing: '-0.028em', fontWeight: '300' }],
        'display-lg': ['4.5rem', { lineHeight: '1', letterSpacing: '-0.035em', fontWeight: '300' }],
        'display-xl': ['6.5rem', { lineHeight: '0.95', letterSpacing: '-0.04em', fontWeight: '300' }],
        'numeral': ['7.5rem', { lineHeight: '0.9', letterSpacing: '-0.045em', fontWeight: '300' }],
      },
      borderRadius: {
        none: 'var(--radius-none)',
        sm: 'var(--radius-sm)',
        DEFAULT: 'var(--radius)',
        pill: 'var(--radius-pill)',
      },
      // Still no drop shadow under a card. `lift` is an inset hairline along
      // the top edge — the way a real edge catches light — over a wide, very
      // soft ambient shadow that reads as distance rather than as a box.
      boxShadow: {
        none: 'none',
        lift: [
          'inset 0 1px 0 0 hsl(var(--edge-light) / var(--edge-light-alpha))',
          '0 1px 2px -1px hsl(var(--ambient) / var(--ambient-alpha))',
          '0 12px 32px -12px hsl(var(--ambient) / var(--ambient-alpha))',
        ].join(', '),
        'lift-hover': [
          'inset 0 1px 0 0 hsl(var(--edge-light) / calc(var(--edge-light-alpha) * 2))',
          '0 2px 4px -2px hsl(var(--ambient) / var(--ambient-alpha))',
          '0 24px 56px -16px hsl(var(--ambient) / var(--ambient-alpha))',
        ].join(', '),
      },
      spacing: {
        gutter: '1.5rem',
        'gutter-lg': '3rem',
        nav: '4.5rem',
      },
      maxWidth: {
        page: '84rem',
        reading: '34rem',
      },
      transitionTimingFunction: {
        DEFAULT: 'var(--ease)',
        ease: 'var(--ease)',
      },
      transitionDuration: {
        DEFAULT: 'var(--dur)',
      },
      keyframes: {
        'rise': {
          from: { opacity: '0', transform: 'translateY(12px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'fade': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
      },
      animation: {
        rise: 'rise var(--dur) var(--ease) both',
        fade: 'fade var(--dur-slow) var(--ease) both',
      },
    },
  },
  plugins: [animate],
};

export default config;
