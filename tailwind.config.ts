import type { Config } from 'tailwindcss'

// The Tailwind side of the design system.
//
// Every colour here reads a custom property from app/globals.css, so a component
// names a token (`bg-surface-subtle`) and never a colour. The token values,
// their hex and their measured contrast live in lib/design/tokens.ts and are
// asserted in lib/design/contrast.test.ts.
//
// What the config decides:
//   * one shadow, for overlays. Cards are a 1px border;
//   * radii 6 / 8 / 12 / 16, and nothing else except a pill;
//   * a 4px spacing scale with three named control heights (36 / 44 / 52);
//   * the type scale, so `text-h1` means 30/36 semibold and not "roughly big";
//   * three container widths: dashboard 1152, public 1200, reading 70ch.

const config: Config = {
  darkMode: ['class'],
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    '*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    // One shadow in the system, and it belongs to overlays: a dialog, a sheet, a
    // popover, a dropdown. Replacing the scale (not extending it) means a card
    // cannot quietly pick up `shadow-sm`.
    boxShadow: {
      none: 'none',
      overlay: 'var(--shadow-overlay)',
    },
    extend: {
      colors: {
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        // The neutral surfaces, named for what they are rather than how dark
        // they are, so a page reads "put this on a subtle surface".
        surface: {
          DEFAULT: 'hsl(var(--background))',
          subtle: 'hsl(var(--surface-subtle))',
          muted: 'hsl(var(--surface-muted))',
        },
        // Semantic pairs. `text-success` is the text colour, `bg-success-subtle`
        // the pale surface it was measured against, `border-success` the edge of
        // the box. Each is always drawn with an icon and a word as well.
        success: {
          DEFAULT: 'hsl(var(--success))',
          subtle: 'hsl(var(--success-subtle))',
        },
        warning: {
          DEFAULT: 'hsl(var(--warning))',
          subtle: 'hsl(var(--warning-subtle))',
        },
        danger: {
          DEFAULT: 'hsl(var(--danger))',
          subtle: 'hsl(var(--danger-subtle))',
        },
        info: {
          DEFAULT: 'hsl(var(--info))',
          subtle: 'hsl(var(--info-subtle))',
        },
        brand: {
          50: 'hsl(var(--brand-50) / <alpha-value>)',
          100: 'hsl(var(--brand-100) / <alpha-value>)',
          200: 'hsl(var(--brand-200) / <alpha-value>)',
          300: 'hsl(var(--brand-300) / <alpha-value>)',
          400: 'hsl(var(--brand-400) / <alpha-value>)',
          500: 'hsl(var(--brand-500) / <alpha-value>)',
          600: 'hsl(var(--brand-600) / <alpha-value>)',
          700: 'hsl(var(--brand-700) / <alpha-value>)',
          800: 'hsl(var(--brand-800) / <alpha-value>)',
          900: 'hsl(var(--brand-900) / <alpha-value>)',
          950: 'hsl(var(--brand-950) / <alpha-value>)',
          ink: 'hsl(var(--brand-ink) / <alpha-value>)',
        },
        border: 'hsl(var(--border))',
        'border-strong': 'hsl(var(--border-strong))',
        'border-control': 'hsl(var(--border-control))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        chart: {
          '1': 'hsl(var(--chart-1))',
          '2': 'hsl(var(--chart-2))',
          '3': 'hsl(var(--chart-3))',
          '4': 'hsl(var(--chart-4))',
          '5': 'hsl(var(--chart-5))',
        },
        sidebar: {
          DEFAULT: 'hsl(var(--sidebar-background))',
          foreground: 'hsl(var(--sidebar-foreground))',
          primary: 'hsl(var(--sidebar-primary))',
          'primary-foreground': 'hsl(var(--sidebar-primary-foreground))',
          accent: 'hsl(var(--sidebar-accent))',
          'accent-foreground': 'hsl(var(--sidebar-accent-foreground))',
          border: 'hsl(var(--sidebar-border))',
          ring: 'hsl(var(--sidebar-ring))',
        },
      },
      borderRadius: {
        none: '0',
        sm: '6px',
        DEFAULT: '8px',
        md: '8px',
        lg: '12px',
        xl: '16px',
        full: '9999px',
      },
      borderWidth: {
        DEFAULT: '1px',
        '0': '0',
        '2': '2px',
      },
      fontFamily: {
        sans: ['var(--font-inter)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      // The type scale. Public display sizes are for public pages only; a signed
      // in app starts at h1.
      fontSize: {
        display: ['48px', { lineHeight: '52px', letterSpacing: '-0.03em', fontWeight: '600' }],
        'display-sm': ['36px', { lineHeight: '40px', letterSpacing: '-0.02em', fontWeight: '600' }],
        h1: ['30px', { lineHeight: '36px', letterSpacing: '-0.02em', fontWeight: '600' }],
        h2: ['22px', { lineHeight: '28px', letterSpacing: '-0.01em', fontWeight: '600' }],
        h3: ['18px', { lineHeight: '24px', letterSpacing: '0em', fontWeight: '500' }],
        body: ['15px', { lineHeight: '24px', letterSpacing: '0em', fontWeight: '400' }],
        dense: ['14px', { lineHeight: '20px', letterSpacing: '0em', fontWeight: '400' }],
        small: ['13px', { lineHeight: '18px', letterSpacing: '0em', fontWeight: '400' }],
        caption: ['12px', { lineHeight: '16px', letterSpacing: '0em', fontWeight: '400' }],
      },
      // 4px base. The three control heights are the only heights a control may
      // be: 36 in a dense desktop toolbar, 44 as the default and the minimum on
      // a touch screen, 52 for the one action on a form.
      spacing: {
        xs: '4px',
        sm: '8px',
        md: '12px',
        lg: '16px',
        xl: '24px',
        '2xl': '32px',
        '3xl': '48px',
        '4xl': '64px',
        'control-sm': '36px',
        'control-md': '44px',
        'control-lg': '52px',
        'topbar': '56px',
        'sidebar': '256px',
      },
      maxWidth: {
        dashboard: '1152px',
        public: '1200px',
        reading: '70ch',
      },
      transitionDuration: {
        DEFAULT: '150ms',
        fast: '150ms',
      },
      transitionTimingFunction: {
        DEFAULT: 'cubic-bezier(0, 0, 0.2, 1)',
      },
      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' },
        },
        'overlay-in': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.15s cubic-bezier(0, 0, 0.2, 1)',
        'accordion-up': 'accordion-up 0.15s cubic-bezier(0, 0, 0.2, 1)',
        'overlay-in': 'overlay-in 0.15s cubic-bezier(0, 0, 0.2, 1)',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
}

export default config
