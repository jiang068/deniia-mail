/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{js,ts,vue}'],
  theme: {
    extend: {
      colors: {
        app: 'var(--c-app)',
        surface: 'var(--c-surface)',
        surface2: 'var(--c-surface2)',
        surface3: 'var(--c-surface3)',
        line: 'var(--c-border)',
        main: 'var(--c-text)',
        sub: 'var(--c-text-sub)',
        faint: 'var(--c-text-faint)',
        accent: 'var(--c-accent)',
        'accent-h': 'var(--c-accent-hover)',
        'accent-ink': 'var(--c-accent-ink)',
        'accent-soft': 'var(--c-accent-soft)',
        danger: 'var(--c-danger)',
        'danger-soft': 'var(--c-danger-soft)',
        warn: 'var(--c-warn)',
        'warn-soft': 'var(--c-warn-soft)',
        green: 'var(--c-green)',
        'green-soft': 'var(--c-green-soft)',
        blue: 'var(--c-blue)',
        'blue-soft': 'var(--c-blue-soft)',
      },
    },
  },
  plugins: [],
};