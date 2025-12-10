import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "/p98/",
  build: {
    outDir: "docs",
  },
  
  server: {
    proxy: {
      // 当你请求 /deepseek/... 时，Vite 会把它转发给 https://api.deepseek.com/...
      '/deepseek': {
        target: 'https://api.deepseek.com',
        changeOrigin: true, // 允许跨域
        secure: true,       // 如果是 https 接口，通常需要这个
        rewrite: (path) => path.replace(/^\/deepseek/, ''), // 去掉路径中的 /deepseek 前缀
      },
    },
  },
});