import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

// Tauri 期望固定端口与清晰的源码目录监听范围
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    watch: { ignored: ['**/src-tauri/**'] },
  },
  build: {
    target: 'es2021',
    rollupOptions: {
      input: {
        stage: resolve(__dirname, 'index.html'),
        panel: resolve(__dirname, 'panel.html'),
      },
    },
  },
})
