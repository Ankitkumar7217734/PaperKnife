/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        pk: {
          canvas: 'var(--pk-canvas)',
          surface: 'var(--pk-surface)',
          'surface-muted': 'var(--pk-surface-muted)',
          border: 'var(--pk-border)',
          'border-subtle': 'var(--pk-border-subtle)',
          text: 'var(--pk-text)',
          'text-muted': 'var(--pk-text-muted)',
        },
      },
      boxShadow: {
        'pk-sm': 'var(--pk-shadow-sm)',
        'pk-md': 'var(--pk-shadow-md)',
        'pk-lg': 'var(--pk-shadow-lg)',
      },
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', 'system-ui', 'sans-serif'],
      },
      keyframes: {
        slideIn: {
          '0%': { transform: 'translateX(100%)' },
          '100%': { transform: 'translateX(0)' },
        }
      },
      animation: {
        'slide-in': 'slideIn 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards',
      }
    },
  },
  plugins: [],
}
