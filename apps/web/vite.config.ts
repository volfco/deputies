import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const apiProxyTarget = process.env.VITE_API_PROXY_TARGET ?? 'http://localhost:3583';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/health': apiProxyTarget,
      '/auth': apiProxyTarget,
      '/sessions': apiProxyTarget,
      '/events': apiProxyTarget,
      '/webhooks': apiProxyTarget,
    },
  },
});
