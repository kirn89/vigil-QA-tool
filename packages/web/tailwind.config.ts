import type { Config } from 'tailwindcss';

export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        page: '#FAFAF8',
        surface: '#FFFFFF',
        'surface-2': '#F3F2EE',
        line: 'rgba(20,20,16,0.08)',
        ink: { DEFAULT: '#1A1A18', soft: '#6B6B66', faint: '#9A9A93' },
        brand: { DEFAULT: '#3F4D6B', hover: '#33405C' },
        pass: { fg: '#0F6E56', bg: '#E1F5EE' },
        warn: { fg: '#854F0B', bg: '#FAEEDA' },
        broken: { fg: '#A32D2D', bg: '#FCEBEB' },
      },
      fontFamily: { sans: ['var(--font-inter)', 'ui-sans-serif', 'system-ui', 'sans-serif'] },
      borderRadius: { lg: '12px' },
    },
  },
  plugins: [],
} satisfies Config;
