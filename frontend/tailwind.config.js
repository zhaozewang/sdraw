/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        canvas: {
          bg: '#f8f9fa',
          grid: '#e2e8f0',
        },
        toolbar: {
          bg: '#ffffff',
          border: '#e2e8f0',
          hover: '#f1f5f9',
          active: '#e2e8f0',
        },
        inspector: {
          bg: '#ffffff',
          border: '#e2e8f0',
          section: '#f8fafc',
        },
        accent: {
          DEFAULT: '#3b82f6',
          light: '#93bbfd',
        },
      },
      fontSize: {
        '2xs': '0.625rem',
      },
    },
  },
  plugins: [],
}
