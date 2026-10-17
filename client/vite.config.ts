import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Deux pages : le jeu (index.html) et le tableau de bord d'administration (admin.html, servi sur /admin).
  build: { rollupOptions: { input: { main: 'index.html', admin: 'admin.html' } } },
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/api': 'http://localhost:3001',
      '/ws': { target: 'ws://localhost:3001', ws: true },
    },
  },
});
