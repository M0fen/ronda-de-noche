import { defineConfig, type Plugin } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// Link previews (WhatsApp, Facebook, X) need absolute addresses: each Vercel project builds with its own
// production domain; anywhere else, the main one.
const SITE = process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : 'https://ronda-de-noche-ez7q.vercel.app';
const siteUrl = (): Plugin => ({ name: 'site-url', transformIndexHtml: html => html.replaceAll('%SITE_URL%', SITE) });

// `npm run build` → dist/ for Vercel (three.js bundled), with registro.html (the play log) beside the game.
// `npm run build:single` → one HTML file that loads three.js from jsDelivr through an import map.
export default defineConfig(({ mode }) => ({
  base: './',
  plugins: mode === 'single' ? [siteUrl(), viteSingleFile()] : [siteUrl()],
  build: {
    outDir: mode === 'single' ? 'dist-single' : 'dist',
    target: 'es2020',
    chunkSizeWarningLimit: 2000,
    rollupOptions: mode === 'single' ? { external: ['three', /^three\/examples\//] } : { input: { main: 'index.html', registro: 'registro.html' } },
  },
}));
