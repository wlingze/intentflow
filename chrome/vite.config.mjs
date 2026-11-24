import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    cssCodeSplit: false,
    minify: false,
    lib: {
      entry: 'src/main.js',
      name: 'IntentflowUserscript',
      formats: ['iife'],
      fileName: () => 'app.js',
      cssFileName: 'app',
    },
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
        assetFileNames: 'assets/[name][extname]',
      },
    },
  },
});
