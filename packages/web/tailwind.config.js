/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Dark, calm palette - deliberately NOT the grey Windows look.
        panel: '#141821',
        panel2: '#1b2130',
        edge: '#2a3242',
        ink: '#e6e9ef',
        muted: '#8b95a7',
        long: '#22c55e',
        short: '#f43f5e',
        accent: '#38bdf8',
      },
      fontFamily: {
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
    },
  },
  plugins: [],
}
