import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: { outDir: '../public/ui', emptyOutDir: true },
  server: {
    port: 5173, strictPort: true,
    proxy: {
      '/api': { target: 'http://127.0.0.1:18987' },
      '/ws': { target: 'ws://127.0.0.1:18987', ws: true },
    },
  },
});
