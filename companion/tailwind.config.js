/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        melange: {
          crimson: '#E13A26',
          deep: '#831613',
          void: '#120303',
          garnet: '#1D0505',
          ink: '#140404',
        },
      },
      fontFamily: {
        sans: [
          'Plus Jakarta Sans',
          'Inter',
          'SF Pro Display',
          'system-ui',
          '-apple-system',
          'sans-serif',
        ],
      },
      letterSpacing: {
        editorial: '-0.03em',
      },
      transitionTimingFunction: {
        spring: 'cubic-bezier(0.22, 1, 0.36, 1)',
      },
    },
  },
  plugins: [],
};
