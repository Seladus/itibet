module.exports = {
  purge: ["src/public/**/*.html"],
  darkMode: false, // or 'media' or 'class'
  theme: {
    extend: {
      colors: {
        primary: {
          50: "#fbf5e1",
          100: "#ede1c1",
          200: "#dfce9d",
          300: "#d1ba7a",
          400: "#c4a655",
          500: "#aa8d3b",
          600: "#846e2d",
          700: "#5f4e1e",
          800: "#3a2f0f",
          900: "#161000",
        },
        secondary: {
          50: "#ecf1fe",
          100: "#cdd4e7",
          200: "#adb7d2",
          300: "#8d9abf",
          400: "#6c7dac",
          500: "#536492",
          600: "#404d72",
          700: "#2d3752",
          800: "#1a2133",
          900: "#050b17",
        },
        // primary: '#C4A756',
        // secondary: '#283149',
      },
    },
    fontFamily: {
      downcome: ["Downcome", "sans-serif"],
    },
  },
  variants: {
    extend: {},
  },
  plugins: [require("@tailwindcss/forms")],
};
