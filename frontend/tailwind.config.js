/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        fast: { DEFAULT: "#10b981", light: "#d1fae5", dark: "#065f46" },
        slow: { DEFAULT: "#6366f1", light: "#e0e7ff", dark: "#3730a3" },
        warn: { DEFAULT: "#f59e0b", light: "#fef3c7" },
        // Design system tokens
        'bg-base': '#0a0e1a',
        'bg-surface': '#111827',
        'bg-elevated': '#1a2235',
        'bg-overlay': '#1e2d45',
        'border-subtle': '#1e2d45',
        'border-default': '#2a3f5f',
        'border-strong': '#3b5278',
        'text-primary': '#e8edf5',
        'text-secondary': '#8b9ab5',
        'text-muted': '#4a5a75',
        'text-accent': '#60a5fa',
        'accent-blue': '#3b82f6',
        'accent-green': '#10b981',
        'accent-amber': '#f59e0b',
        'accent-red': '#ef4444',
        'accent-purple': '#8b5cf6',
      },
      boxShadow: {
        'glow-blue': '0 0 20px rgba(59, 130, 246, 0.3)',
        'glow-green': '0 0 20px rgba(16, 185, 129, 0.3)',
        'glow-amber': '0 0 20px rgba(245, 158, 11, 0.3)',
      },
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
      animation: {
        'fade-in-up': 'fadeInUp 0.2s ease-out both',
        'fade-in': 'fadeIn 0.15s ease-out both',
        'blink': 'blink 1s ease-in-out infinite',
        'pulse-dot': 'pulse-dot 2s ease-in-out infinite',
        'slide-in-left': 'slideInLeft 0.2s ease-out both',
        'shimmer': 'shimmer 1.5s infinite',
        'count-up': 'countUp 0.2s ease-out both',
      },
      keyframes: {
        fadeInUp: {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        fadeIn: {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        blink: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0' },
        },
        pulseDot: {
          '0%, 100%': { transform: 'scale(1)', opacity: '1' },
          '50%': { transform: 'scale(1.3)', opacity: '0.7' },
        },
        slideInLeft: {
          from: { opacity: '0', transform: 'translateX(-12px)' },
          to: { opacity: '1', transform: 'translateX(0)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        countUp: {
          from: { opacity: '0', transform: 'translateY(4px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
      },
      borderRadius: {
        '2.5': '10px',
      },
    },
  },
  plugins: [],
};
