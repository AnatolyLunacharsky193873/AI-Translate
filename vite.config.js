import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import { HttpsProxyAgent } from "https-proxy-agent"

const configuredProxy = process.env.VITE_OUTBOUND_PROXY
const outboundProxy =
  configuredProxy === "direct" ? "" :
  configuredProxy ||
  process.env.HTTPS_PROXY ||
  process.env.HTTP_PROXY ||
  "http://127.0.0.1:1081"

const outboundProxyAgent = outboundProxy ? new HttpsProxyAgent(outboundProxy) : undefined

export default defineConfig({
  plugins: [react()],
  base: "/AI-Translate/",
  build: {
    outDir: "docs",
  },
  server: {
    host: "127.0.0.1",
    proxy: {
      "/deepseek": {
        target: "https://api.deepseek.com",
        changeOrigin: true,
        secure: true,
        agent: outboundProxyAgent,
        rewrite: (path) => path.replace(/^\/deepseek/, ""),
      },
      "/openai": {
        target: "https://api.openai.com/v1",
        changeOrigin: true,
        secure: true,
        agent: outboundProxyAgent,
        rewrite: (path) => path.replace(/^\/openai/, ""),
      },
    },
  },
})
