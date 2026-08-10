import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// For local (non-Docker) dev: `npm run dev` in frontend/ with the backend
// running separately on :4000. In Docker, nginx handles this proxying
// instead (see nginx.conf) and this block is unused.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/socket.io': {
        target: 'http://localhost:4000',
        ws: true,
      },
      '/api': {
        target: 'http://localhost:4000',
      },
    },
  },
});
