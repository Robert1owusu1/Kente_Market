import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    target: 'es2020',
    sourcemap: false,
    cssCodeSplit: true,
    // Split vendors into persistent, cacheable chunks so repeat visits
    // load almost nothing and fewer bytes block first paint.
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return;
          // Big charting library -> only loaded on /admin (already route-split)
          if (id.includes('recharts') || id.includes('d3-') || id.includes('victory-vendor')) {
            return 'charts';
          }
          // Virtual DOM + router (react-router depends on react, keep together)
          if (id.includes('/react/') || id.includes('/react-dom/') || id.includes('/scheduler/') || id.includes('/react-router')) {
            return 'react';
          }
          // State management pulls in react-redux which pulls react-dom -> keep with react-cycle-safe grouping
          if (id.includes('@reduxjs') || id.includes('react-redux')) {
            return 'redux';
          }
          // UI helpers
          if (id.includes('react-icons')) {
            return 'icons';
          }
          if (id.includes('react-toastify')) {
            return 'toastify';
          }
          if (id.includes('slick-carousel') || id.includes('/swiper/') || id.includes('/react-slick')) {
            return 'slider';
          }
          if (id.includes('@paystack')) {
            return 'http';
          }
          // axios is imported by many components; keep it in the shared vendor chunk
          return 'vendor';
        },
      },
    },
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true,
        secure: false,
      },
      '/uploads': {
        target: 'http://localhost:5000',
        changeOrigin: true,
      },
      '/images': {
        target: 'http://localhost:5000',
        changeOrigin: true,
      }
    },
  },
})
