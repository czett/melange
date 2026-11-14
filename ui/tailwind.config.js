/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        melange: {
          crimson: "#E13A26",
          hot: "#FF5A42",
          deep: "#831613",
          edge: "#3D0706",
          ink: "#160303"
        },
        garnet: {
          glass: "rgba(15, 2, 2, 0.76)",
          inner: "rgba(10, 1, 1, 0.62)"
        }
      },
      fontFamily: {
        sans: ["Plus Jakarta Sans", "Inter", "system-ui", "sans-serif"]
      },
      letterSpacing: {
        display: "-0.035em",
        editorial: "-0.02em"
      },
      boxShadow: {
        ambient: "0 14px 36px rgba(15, 2, 2, 0.42)"
      },
      transitionTimingFunction: {
        spring: "cubic-bezier(0.22, 1, 0.36, 1)"
      }
    }
  },
  plugins: []
};
