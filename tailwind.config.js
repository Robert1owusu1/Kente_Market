/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        // Kente-inspired brand palette
        primary: {
          DEFAULT: "#fea928",
          light: "#ffc25c",
          dark: "#ed8900",
          hover: "#f59e0b",
        },
        secondary: "#ed8900",
        gold: {
          DEFAULT: "#d4a017",
          light: "#e8c44a",
          dark: "#b8860b",
        },
        // Warm neutrals for surfaces
        sand: {
          50: "#faf7f0",
          100: "#f4eee1",
          200: "#e8dcc4",
          900: "#1a1611",
        },
        // Dark mode surface palette
        night: {
          800: "#1f2937",
          900: "#111827",
          950: "#0b1120",
        },
        // Deep accent used sparingly across the brand
        royal: {
          DEFAULT: "#4c1d95",
          dark: "#3b1678",
        },
      },
      container: {
        center: true,
        padding: {
          DEFAULT: "1rem",
          sm: "1.5rem",
          md: "2rem",
          lg: "3rem",
        },
      },
      screens: {
        xs: "475px",
      },
    },
  },
  plugins: [
    // eslint-disable-next-line no-undef
    require('tailwind-scrollbar-hide')
  ],
};
