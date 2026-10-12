import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
  // El conversor de HEIC (~3 MB) va en un archivo aparte que solo se baja al subir una foto de iPhone.
  build: { chunkSizeWarningLimit: 3500 },
});
