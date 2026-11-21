import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In production nginx serves this app and sends /api to the backend on the
// same domain. In development Vite forwards /api to the local backend.
export default defineConfig({
  plugins: [react()],
  server: { port: 5174, proxy: { '/api': 'http://localhost:4100' } },
});
