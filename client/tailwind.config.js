/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        /*
         * All brand colors reference CSS variables from index.css.
         * The `<alpha-value>` placeholder lets Tailwind inject opacity
         * so modifiers like bg-brand/10, shadow-brand/20 work correctly.
         *
         * To re-theme: change the --brand (and others) channels in :root.
         */
        brand:        'rgb(var(--brand)        / <alpha-value>)',
        'brand-dark': 'rgb(var(--brand-dark)   / <alpha-value>)',
        accent:       'rgb(var(--brand)        / <alpha-value>)', // alias kept for backwards compat
        accentShadow: 'rgb(var(--brand-dark)   / <alpha-value>)',
        surface:      'rgb(var(--surface)      / <alpha-value>)',
        'surface-2':  'rgb(var(--surface-2)    / <alpha-value>)',
        dark:         'rgb(var(--bg)           / <alpha-value>)', // page background (white by default)
        'page-bg':    'rgb(var(--page-bg)      / <alpha-value>)',
        'sidebar-bg': 'rgb(var(--sidebar-bg)   / <alpha-value>)',
      },
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
      },
      minHeight: {
        'touch': '44px', // fat-finger safe minimum
      },
      minWidth: {
        'touch': '44px',
      },
    },
  },
  plugins: [],
}
