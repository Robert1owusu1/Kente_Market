import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    target: 'es2020',
    sourcemap: false,
    cssCodeSplit: true,
    // NOTE: no manualChunks here. The previous hand-rolled vendor/react/redux
    // split produced CHUNK CYCLES (redux -> vendor -> react -> redux) that
    // crashed at runtime with "can't access property 'Activity', ct is
    // undefined" on React 19.2 (react-dom reads React.Activity at module init).
    // Letting Rollup split automatically avoids cyclic module evaluation.
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
