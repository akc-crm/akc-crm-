import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    // Tăng chunk size warning limit
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        // Tách các thư viện nặng thành chunk riêng - chỉ load khi cần
        manualChunks: {
          // React core - load đầu tiên, cache lâu dài
          'vendor-react': ['react', 'react-dom'],
          // Supabase - load sau khi React xong
          'vendor-supabase': ['@supabase/supabase-js'],
          // Chart.js - chỉ load khi vào trang Dashboard/Reports
          'vendor-chart': ['chart.js'],
          // xlsx - chỉ load khi export Excel
          'vendor-xlsx': ['xlsx'],
        },
        // Đặt tên file có hash để browser cache hiệu quả
        chunkFileNames: 'assets/[name]-[hash].js',
        entryFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash].[ext]',
      },
    },
    // Bật minify tốt nhất
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: false, // Giữ console để debug
        drop_debugger: true,
        pure_funcs: [],
      },
    },
    // Bật source map cho production debugging
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
    exclude: ['chart.js', 'xlsx'], // Lazy load khi cần
  },
});
