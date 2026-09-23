// @ts-check

import typography from '@tailwindcss/typography';
import plugin from 'tailwindcss/plugin';
import tailwindcssAnimate from 'tailwindcss-animate';
import registerResponsiveUtilities from './tailwind-responsive-utilities.mjs';

/** @type {import('tailwindcss').Config} */
const config = {
  // Dark variants fire when the element (or an ancestor) has `.dark`, unless
  // a `.light` wrapper intervenes. The `.light` wrapper is used by
  // StorefrontThemeProvider to force light mode on the storefront subtree
  // even when the root `<html>` carries `.dark` from next-themes.
  // `:where()` keeps specificity low so ordinary utilities still win.
  // Reference: https://v3.tailwindcss.com/docs/dark-mode (custom variant form).
  darkMode: [
    'variant',
    '&:where(.dark, .dark *):not(.light):not(.light *):not(.storefront-light):not(.storefront-light *):not(.storefront-mode-system):not(.storefront-mode-system *)',
  ],
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
    './src/templates/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    container: {
      center: true,
      padding: '2rem',
      screens: {
        '2xl': '1400px',
      },
    },
    extend: {
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
      },
      borderRadius: {
        none: 'var(--theme-radius-none)',
        sm: 'var(--theme-radius-sm)',
        DEFAULT: 'var(--theme-radius-md)',
        lg: 'var(--theme-radius-lg)',
        xl: 'var(--theme-radius-xl)',
        '2xl': 'var(--theme-radius-2xl)',
        full: 'var(--theme-radius-full)',
      },
      spacing: {
        'theme-xs': 'var(--theme-space-xs)',
        'theme-sm': 'var(--theme-space-sm)',
        'theme-md': 'var(--theme-space-md)',
        'theme-lg': 'var(--theme-space-lg)',
        'theme-xl': 'var(--theme-space-xl)',
        'theme-2xl': 'var(--theme-space-2xl)',
        'theme-3xl': 'var(--theme-space-3xl)',
        // Touch target minimum (44px for WCAG 2.5.5)
        touch: '2.75rem',
        'touch-lg': '3rem',
      },
      // Dynamic viewport units (2025 best practice)
      height: {
        'screen-dvh': '100dvh',
        'screen-svh': '100svh',
        'screen-lvh': '100lvh',
        'dvh-50': '50dvh',
        'dvh-75': '75dvh',
        'dvh-90': '90dvh',
      },
      minHeight: {
        'screen-dvh': '100dvh',
        'screen-svh': '100svh',
        'screen-lvh': '100lvh',
        'dvh-50': '50dvh',
        'dvh-75': '75dvh',
      },
      maxHeight: {
        'screen-dvh': '100dvh',
        'screen-svh': '100svh',
        'screen-lvh': '100lvh',
      },
      width: {
        'screen-dvw': '100dvw',
        'screen-svw': '100svw',
        'screen-lvw': '100lvw',
      },
      // Fluid typography using clamp() (2025 elite standard)
      fontSize: {
        'fluid-xs': [
          'clamp(0.625rem, 0.6rem + 0.2vw, 0.75rem)',
          { lineHeight: '1.5' },
        ],
        'fluid-sm': [
          'clamp(0.75rem, 0.7rem + 0.3vw, 0.875rem)',
          { lineHeight: '1.5' },
        ],
        'fluid-base': [
          'clamp(0.875rem, 0.85rem + 0.4vw, 1rem)',
          { lineHeight: '1.6' },
        ],
        'fluid-lg': [
          'clamp(1rem, 0.95rem + 0.5vw, 1.25rem)',
          { lineHeight: '1.5' },
        ],
        'fluid-xl': [
          'clamp(1.25rem, 1.2rem + 0.6vw, 1.5rem)',
          { lineHeight: '1.4' },
        ],
        'fluid-2xl': [
          'clamp(1.5rem, 1.4rem + 0.8vw, 2rem)',
          { lineHeight: '1.3' },
        ],
        'fluid-3xl': [
          'clamp(2rem, 1.8rem + 1.2vw, 2.5rem)',
          { lineHeight: '1.2' },
        ],
        'fluid-4xl': [
          'clamp(2.5rem, 2.2rem + 1.5vw, 3.5rem)',
          { lineHeight: '1.1' },
        ],
        'fluid-5xl': [
          'clamp(3rem, 2.5rem + 2.5vw, 4.5rem)',
          { lineHeight: '1' },
        ],
        'fluid-hero': ['clamp(2rem, 1.8rem + 3vw, 3rem)', { lineHeight: '1' }],
      },
      boxShadow: {
        none: 'var(--theme-shadow-none)',
        sm: 'var(--theme-shadow-sm)',
        DEFAULT: 'var(--theme-shadow-md)',
        lg: 'var(--theme-shadow-lg)',
        xl: 'var(--theme-shadow-xl)',
        '2xl': 'var(--theme-shadow-2xl)',
        inner: 'var(--theme-shadow-inner)',
      },
      fontFamily: {
        // --font-naira: ~1.2KB Inter subset unicode-range-scoped to ₦ (U+20A6);
        // all other glyphs fall through to Inter (--font-sans).
        sans: [
          'var(--font-naira, var(--font-sans))',
          'var(--font-sans)',
          'ui-sans-serif',
          'system-ui',
          'sans-serif',
        ],
      },
      keyframes: {
        'accordion-down': {
          from: {
            height: '0',
          },
          to: {
            height: 'var(--radix-accordion-content-height)',
          },
        },
        'accordion-up': {
          from: {
            height: 'var(--radix-accordion-content-height)',
          },
          to: {
            height: '0',
          },
        },
        'float-up': {
          '0%': {
            opacity: '1',
            transform: 'translateY(0) scale(1)',
          },
          '100%': {
            opacity: '0',
            transform: 'translateY(-60px) scale(1.5)',
          },
        },
        // One-shot icon micro-interactions (CSS replacements for the removed
        // animation runtime; transform/opacity-only, no layout shift).
        'nudge-up': {
          '0%, 100%': {
            transform: 'translateY(0)',
          },
          '50%': {
            transform: 'translateY(-2px)',
          },
        },
        wiggle: {
          '0%, 100%': {
            transform: 'rotate(0deg)',
          },
          '20%': {
            transform: 'rotate(-10deg)',
          },
          '40%': {
            transform: 'rotate(10deg)',
          },
          '60%': {
            transform: 'rotate(-10deg)',
          },
          '80%': {
            transform: 'rotate(10deg)',
          },
        },
        shake: {
          '0%, 13%, 100%': {
            transform: 'translateX(0)',
          },
          '3%': {
            transform: 'translateX(-2px)',
          },
          '6%': {
            transform: 'translateX(2px)',
          },
          '10%': {
            transform: 'translateX(-2px)',
          },
        },
        'slide-right': {
          '0%, 100%': {
            transform: 'translateX(0)',
          },
          '50%': {
            transform: 'translateX(4px)',
          },
        },
      },
      // Named transition durations to avoid Tailwind "ambiguous class" warnings
      transitionDuration: {
        3000: '3000ms',
        4000: '4000ms',
        5000: '5000ms',
        10000: '10000ms',
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
        'float-up': 'float-up 1s ease-out forwards',
        'slide-right': 'slide-right 1.5s ease-in-out infinite',
        'nudge-up': 'nudge-up 0.3s ease-out',
        wiggle: 'wiggle 0.5s ease-out',
        shake: 'shake 2.4s ease-in-out infinite',
      },
    },
  },
  plugins: [
    tailwindcssAnimate,
    typography,
    plugin(registerResponsiveUtilities),
  ],
};

export default config;
