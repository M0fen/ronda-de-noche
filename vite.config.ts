import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// `npm run build` → dist/ for Vercel (three.js bundled), with registro.html (the play log) beside the game.
// `npm run build:single` → one HTML file that loads three.js from jsDelivr through an import map.
export default defineConfig(({ mode }) => ({
  base: './',
  plugins: mode === 'single' ? [viteSingleFile()] : [],
  build: {
    outDir: mode === 'single' ? 'dist-single' : 'dist',
    target: 'es2020',
    chunkSizeWarningLimit: 2000,
    rollupOptions: mode === 'single' ? { external: ['three', /^three\/examples\//] } : { input: { main: 'index.html', registro: 'registro.html' } },
  },
}));
