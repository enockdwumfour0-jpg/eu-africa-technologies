/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: { green: '#168447', yellow: '#F4C430', black: '#151515', grey: '#F5F7F5' },
      },
      fontFamily: { sans: ['"Source Sans 3"', 'system-ui', 'sans-serif'], display: ['Fraunces', 'serif'] },
    },
  },
  plugins: [],
}
