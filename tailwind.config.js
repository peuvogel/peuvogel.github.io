/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './index.html',
    './assets/**/*.js',
    './tests/**/*.js',
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: '#8B5CF6',
          soft:    'rgba(139,92,246,0.08)',
          glow:    'rgba(139,92,246,0.4)',
        },
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
