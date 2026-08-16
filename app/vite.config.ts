import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // Honour PORT so tooling can assign a free port when 5173 is taken.
    port: Number(process.env.PORT) || 5173,
  },
  resolve: {
    alias: { '@': new URL('./src', import.meta.url).pathname },
  },
  build: {
    rollupOptions: {
      output: {
        // Split the heavy, rarely-changing libraries out so a code change does
        // not force everyone to redownload React on patchy mobile data.
        manualChunks(id: string) {
          if (!id.includes('node_modules')) return
          if (id.includes('framer-motion')) return 'motion'
          if (id.includes('@tanstack')) return 'query'
          if (id.includes('react-router') || id.includes('/react-dom/') || id.includes('/react/')) {
            return 'vendor'
          }
        },
      },
    },
  },
})
