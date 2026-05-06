/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          0: '#FFFFFF',
          50: '#F5F5F5',
          100: '#E5E5E5',
          300: '#A0A0A0',
          400: '#737373',
          500: '#525252',
          600: '#3F3F3F',
          700: '#262626',
          800: '#171717',
          850: '#111111',
          900: '#0A0A0A',
          950: '#050505',
        },
        signal: {
          critical: '#FF4D4D',
          high: '#FF8A3D',
          medium: '#F5C518',
          low: '#A3A3A3',
          clean: '#5EE6A1',
        },
      },
      fontFamily: {
        sans: ['var(--font-geist-sans)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-geist-mono)', 'ui-monospace', 'monospace'],
      },
      letterSpacing: {
        tightest: '-0.04em',
      },
    },
  },
  plugins: [],
};
