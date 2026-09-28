import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Content Security Policy for production builds: only our own scripts run, and the page can only
// talk to its own origin (the API is proxied at /api). This limits the damage of any XSS bug.
// Not applied in dev, where Vite's hot reload needs inline scripts.
// Headers a <meta> tag can't set (HSTS, frame-ancestors) belong on your web host; see README → Deploying.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: blob:",   // QR codes are data: URLs; proof previews are blob: URLs
  "frame-src blob:",               // PDF proof preview
  "media-src 'self' blob: mediastream:", // gate scanner camera
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

const cspInProduction = {
  name: 'entrylink-csp',
  apply: 'build',
  transformIndexHtml: () => [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP }, injectTo: 'head-prepend' }],
};

// In dev, /api is proxied to the Express server so the browser sees one origin (no CORS, SSE just works,
// and the SameSite=Strict session cookie is sent).
export default defineConfig({
  plugins: [react(), cspInProduction],
  server: {
    port: 5173,
    proxy: { '/api': { target: process.env.VITE_API_PROXY || 'http://localhost:4000', changeOrigin: true } },
  },
});
