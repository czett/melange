/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          "Inter",
          "SF Pro Display",
          "system-ui",
          "-apple-system",
          "sans-serif"
        ]
      }
    }
  },
  plugins: []
};
