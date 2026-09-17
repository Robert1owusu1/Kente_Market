import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    target: 'es2020',
    sourcemap: false,
    cssCodeSplit: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          // Split ONLY the React core into its own leaf chunk. Every package
          // here is a member of the react/react-redux/react-router closure whose
          // entire dependency graph is contained within this chunk, so it has no
          // imports back into the main bundle and CANNOT form the chunk cycle
          // that crashed React 19.2 previously ("can't access property
          // 'Activity'") when react/react-dom/redux were hand-split apart.
          // Everything else (recharts, slick, axios, ...) keeps the previous
          // proven automatic single-chunk layout — no behavior change, just the
          // ~500KB react core served as a cacheable static chunk.
          if (!id.includes('node_modules')) return;
          if (/node_modules\/(?:react|react-dom|react-redux|react-router|react-router-dom|react-is|redux|redux-thunk|immer|reselect|scheduler|use-sync-external-store|cookie|set-cookie-parser|@reduxjs\/[^/]+)\//.test(id)) {
            return 'react-core';
          }
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
