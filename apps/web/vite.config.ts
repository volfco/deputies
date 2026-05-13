import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const apiProxyTarget = process.env.VITE_API_PROXY_TARGET ?? 'http://localhost:3583';
const allowedHosts = process.env.VITE_DEV_ALLOWED_HOSTS
  ? process.env.VITE_DEV_ALLOWED_HOSTS.split(',')
      .map((host) => host.trim())
      .filter(Boolean)
  : ['.localhost', '.sslip.io', '.ngrok-free.app', '.ngrok-free.dev', '.ngrok.io', '.trycloudflare.com'];
const apiProxy = { target: apiProxyTarget, ws: true };
const previewProxy = {
  target: apiProxyTarget,
  ws: true,
  xfwd: true,
  bypass(request: {
    headers: {
      host?: string | undefined;
      'x-forwarded-host'?: string | string[] | undefined;
      'x-original-host'?: string | string[] | undefined;
    };
    url?: string | undefined;
  }) {
    return isPreviewRequest(request.headers) ? undefined : request.url;
  },
};

function isPreviewRequest(headers: {
  host?: string | undefined;
  'x-forwarded-host'?: string | string[] | undefined;
  'x-original-host'?: string | string[] | undefined;
}): boolean {
  return [headers.host, headers['x-forwarded-host'], headers['x-original-host']]
    .flatMap((value) => (Array.isArray(value) ? value : value ? [value] : []))
    .some((host) => host.split(',').some((item) => item.trim().startsWith('p-')));
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    hmr: { path: '/__deputies_vite_hmr' },
    allowedHosts,
    proxy: {
      '/health': apiProxy,
      '/auth': apiProxy,
      '/sessions': apiProxy,
      '/events': apiProxy,
      '/webhooks': apiProxy,
      '/': previewProxy,
    },
  },
});
