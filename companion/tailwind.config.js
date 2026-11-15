/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        melange: {
          crimson: '#E13A26',
          hot: '#FF5A42',
          deep: '#831613',
          ink: '#111113',
        },
        obsidian: {
          glass: 'rgba(255, 255, 255, 0.10)',
          heavy: 'rgba(20, 20, 24, 0.62)',
          inner: 'rgba(255, 255, 255, 0.08)',
        },
      },
      fontFamily: {
        sans: [
          'Plus Jakarta Sans',
          '-apple-system',
          'BlinkMacSystemFont',
          'SF Pro Display',
          'SF Pro Text',
          'Inter',
          'system-ui',
          'sans-serif',
        ],
      },
      letterSpacing: {
        display: '-0.035em',
        editorial: '-0.02em',
      },
      boxShadow: {
        ambient: '0 16px 40px rgba(0, 0, 0, 0.35)',
      },
      transitionTimingFunction: {
        spring: 'cubic-bezier(0.22, 1, 0.36, 1)',
      },
    },
  },
  plugins: [],
};
