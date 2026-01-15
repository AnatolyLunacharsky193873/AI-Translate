import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"

export default defineConfig({
  plugins: [react()],
  base: "/AI-Translate/",
  build: {
    outDir: "docs",
  },
  
  //CORS连不上只能这样
  server: {
    proxy: {
      //deepseek
      '/deepseek': {
        target: 'https://api.deepseek.com',
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/deepseek/, ''),
      },
      // OpenAI
      '/openai': {
        target: 'https://api.openai.com/v1',
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/openai/, ''),
      },
    },
  },
})
