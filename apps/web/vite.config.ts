import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const apiProxyTarget = process.env.VITE_API_PROXY_TARGET ?? 'http://localhost:3583';
const allowedHosts = process.env.VITE_DEV_ALLOWED_HOSTS
  ? process.env.VITE_DEV_ALLOWED_HOSTS.split(',')
      .map((host) => host.trim())
      .filter(Boolean)
  : ['.ngrok-free.app', '.ngrok-free.dev', '.ngrok.io', '.trycloudflare.com'];

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    allowedHosts,
    proxy: {
      '/health': apiProxyTarget,
      '/auth': apiProxyTarget,
      '/sessions': apiProxyTarget,
      '/events': apiProxyTarget,
      '/webhooks': apiProxyTarget,
    },
  },
});
