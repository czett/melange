/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        melange: {
          live: "#EF4444",
          ink: "#111318",
          sky: "#0B0E14"
        },
        smoke: {
          surface: "rgba(18, 20, 26, 0.66)",
          heavy: "rgba(15, 17, 22, 0.82)",
          focus: "rgba(28, 31, 40, 0.84)"
        }
      },
      fontFamily: {
        sans: [
          "Inter",
          "-apple-system",
          "BlinkMacSystemFont",
          "SF Pro Display",
          "SF Pro Text",
          "system-ui",
          "sans-serif"
        ],
        display: [
          '"Barlow Condensed"',
          '"Antonio"',
          '"Inter"',
          "system-ui",
          "sans-serif"
        ]
      },
      letterSpacing: {
        display: "-0.045em",
        editorial: "-0.02em"
      },
      boxShadow: {
        ambient: "0 12px 32px rgba(0, 0, 0, 0.36)"
      },
      opacity: {
        92: "0.92"
      },
      transitionTimingFunction: {
        spring: "cubic-bezier(0.34, 1.56, 0.64, 1)"
      }
    }
  },
  plugins: []
};
