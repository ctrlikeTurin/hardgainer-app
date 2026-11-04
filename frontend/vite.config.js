import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

import { cloudflare } from "@cloudflare/vite-plugin";

export default defineConfig({
  plugins: [react(), cloudflare()],
  build: {
    rollupOptions: {
      // Libraries change less often than app code, so separate chunks stay cached across deploys.
      output: { manualChunks: { auth: ['@supabase/auth-js'], react: ['react', 'react-dom', 'react-dom/client'] } },
    },
  },
});