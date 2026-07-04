import { defineConfig } from 'vite';

// Three.js r128 通过 CDN 全局加载，不打包到 bundle 中
export default defineConfig({
  root: '.',
  base: './',
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: true,
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        // core/services/ui 之间存在相互导入（如 auth-ui -> auth -> config），
        // 合并为单个 framework chunk 避免循环分块；游戏主逻辑独立成块
        manualChunks(id) {
          if (id.includes('/src/core/') || id.includes('/src/services/') || id.includes('/src/ui/')) {
            return 'framework';
          }
        }
      }
    }
  },
  server: {
    port: 8080,
    open: '/index.html',
    proxy: {
      // 开发模式下代理后端 API（避免 CORS 问题）
      '/auth': 'http://127.0.0.1:8000',
      '/leaderboard': 'http://127.0.0.1:8000',
      '/progress': 'http://127.0.0.1:8000',
      '/challenges': 'http://127.0.0.1:8000',
      '/health': 'http://127.0.0.1:8000'
    }
  }
});
