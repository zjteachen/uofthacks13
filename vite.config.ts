import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { copyFileSync } from 'fs';

export default defineConfig({
  base: './',
  plugins: [
    react(),
    {
      name: 'copy-manifest',
      closeBundle() {
        copyFileSync('public/manifest.json', 'dist/manifest.json');
      }
    }
  ],
  build: {
    rollupOptions: {
      input: {
        popup: resolve(__dirname, 'popup.html'),
        options: resolve(__dirname, 'options.html'),
        'content/chatgpt-monitor': resolve(__dirname, 'src/content/chatgpt-monitor.js'),
      },
      output: {
        entryFileNames: (chunkInfo) => {
          // Content script goes directly to content folder
          if (chunkInfo.name === 'content/chatgpt-monitor') {
            return 'content/chatgpt-monitor.js';
          }
          return 'assets/[name].js';
        },
        chunkFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name].[ext]'
      }
    },
    outDir: 'dist',
  },
});
