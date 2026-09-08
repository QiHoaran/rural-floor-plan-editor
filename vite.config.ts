/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  // 预构建首屏依赖，避免 Vite 在首次请求时才做依赖发现并触发中途重新优化 + 整页刷新。
  optimizeDeps: {
    include: [
      'react',
      'react-dom',
      'react-dom/client',
      'react/jsx-dev-runtime',
      // 编辑器改为懒加载后 zustand 只经由异步块可达，必须显式 include。
      'zustand',
    ],
  },
  server: {
    // 启动时预热首屏模块，缩短 dev 模式第一次打开索引页的等待。
    warmup: {
      clientFiles: [
        './src/main.tsx',
        './src/App.tsx',
        './src/index.css',
        './src/projects/ProjectHome.tsx',
        './src/projects/ProjectCard.tsx',
        './src/projects/ProjectHome.module.css',
        './src/projects/useProjectIndex.ts',
        './src/api/projectApi.ts',
      ],
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['tests/**/*.test.{ts,tsx}'],
  },
})
