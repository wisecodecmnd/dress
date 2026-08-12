/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // DENIMQUE palette — dark luxury, editorial, minimal
        obsidian: '#0A0A0B', // near-black base
        charcoal: '#141416', // raised surface
        stone: '#3A3A3F', // borders / muted UI
        fog: '#8A8A93', // tertiary text
        mist: '#B8B8C0', // secondary text
        pearl: '#F4F2EE', // primary text / off-white
        denim: '#5C7C99', // washed denim blue accent
        indigo: '#26374A', // deep denim
      },
      fontFamily: {
        display: ['"Cormorant Garamond"', 'Georgia', 'serif'],
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
      },
      fontSize: {
        'display-xl': ['clamp(3rem, 9vw, 8.5rem)', { lineHeight: '0.92', letterSpacing: '-0.02em' }],
        'display-lg': ['clamp(2.5rem, 6.5vw, 6rem)', { lineHeight: '0.95', letterSpacing: '-0.02em' }],
        'display-md': ['clamp(2rem, 4.5vw, 4rem)', { lineHeight: '1.02', letterSpacing: '-0.015em' }],
        'body-lg': ['clamp(1rem, 1.15vw, 1.125rem)', { lineHeight: '1.7' }],
        meta: ['0.6875rem', { lineHeight: '1.4', letterSpacing: '0.18em' }],
      },
      transitionTimingFunction: {
        editorial: 'cubic-bezier(0.16, 1, 0.3, 1)',
      },
      keyframes: {
        'fade-up': {
          from: { opacity: '0', transform: 'translateY(24px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'drawer-in': {
          from: { transform: 'translateX(100%)' },
          to: { transform: 'translateX(0)' },
        },
        'hero-in': {
          from: { opacity: '0', transform: 'translateY(38px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'fade-up': 'fade-up 0.8s cubic-bezier(0.16, 1, 0.3, 1) both',
        'drawer-in': 'drawer-in 0.5s cubic-bezier(0.16, 1, 0.3, 1) both',
        // Hero entrance. Deliberately CSS, not GSAP: a compositor animation
        // always reaches its end state, so copy can never be left invisible.
        'hero-in': 'hero-in 1.2s cubic-bezier(0.16, 1, 0.3, 1) both',
      },
    },
  },
  plugins: [],
};
