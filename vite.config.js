import { defineConfig } from 'vite';

// 开发预览用一个不常见的端口，避免和本机别的页面撞在一起。
export default defineConfig({
  server: {
    host: '0.0.0.0',
    port: 43123,
    strictPort: true,
  },
  preview: {
    host: '0.0.0.0',
    port: 43124,
    strictPort: true,
  },
  // three.js 本身会超过 Vite 默认的 500 kB 提示。这一页就一个脚本，不拆包。
  build: {
    chunkSizeWarningLimit: 800,
  },
});
