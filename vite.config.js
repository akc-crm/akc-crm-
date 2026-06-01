import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    // Tăng chunk size warning limit
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        // Tách vendor thành function (Vite 8.x yêu cầu function, không phải object)
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('react') || id.includes('react-dom')) {
              return 'vendor-react';
            }
            if (id.includes('@supabase')) {
              return 'vendor-supabase';
            }
            return 'vendor';
          }
        },
        // Đặt tên file có hash để browser cache hiệu quả
        chunkFileNames: 'assets/[name]-[hash].js',
        entryFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash].[ext]',
      },
    },
    // Bật minify
    minify: true,
    // Không cần source map production
    sourcemap: false,
    // Target modern browsers để bundle nhỏ hơn
    target: 'es2020',
  },
  // Tối ưu dev server
  server: {
    host: '0.0.0.0',
  },
  // Tối ưu dependencies pre-bundling
  optimizeDeps: {
    include: ['react', 'react-dom', '@supabase/supabase-js'],
  },
});
