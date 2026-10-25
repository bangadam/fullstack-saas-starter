import { cloudflare } from '@cloudflare/vite-plugin'
import tailwindcss from '@tailwindcss/vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import tsconfigPaths from 'vite-tsconfig-paths'

export default defineConfig({
  server: {
    port: 3000,
  },
  plugins: [
    // Cloudflare plugin must be registered before tanstackStart and react so
    // the 'ssr' environment exists before Start configures it.
    tailwindcss(),
    cloudflare({ viteEnvironment: { name: 'ssr' } }),
    tanstackStart(),
    react(),
    tsconfigPaths(),
  ],
})
