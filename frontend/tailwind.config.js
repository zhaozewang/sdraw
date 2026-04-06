/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        canvas: {
          bg: 'var(--canvas-bg)',
          grid: 'var(--canvas-grid)',
        },
        toolbar: {
          bg: 'var(--toolbar-bg)',
          border: 'var(--toolbar-border)',
          hover: 'var(--toolbar-hover)',
          active: 'var(--toolbar-active)',
        },
        inspector: {
          bg: 'var(--inspector-bg)',
          border: 'var(--inspector-border)',
          section: 'var(--inspector-section)',
        },
        accent: {
          DEFAULT: '#3b82f6',
          light: '#93bbfd',
        },
        // Semantic surface/text tokens for dark mode
        surface: {
          primary: 'var(--surface-primary)',
          secondary: 'var(--surface-secondary)',
          tertiary: 'var(--surface-tertiary)',
        },
        'on-surface': {
          primary: 'var(--text-primary)',
          secondary: 'var(--text-secondary)',
          muted: 'var(--text-muted)',
          disabled: 'var(--text-disabled)',
        },
        border: {
          DEFAULT: 'var(--border-default)',
          light: 'var(--border-light)',
        },
      },
      fontSize: {
        '2xs': '0.625rem',
      },
    },
  },
  plugins: [],
}
