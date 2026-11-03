import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The portal is served from /portal-app/ (assets) and mounted on clean routes
// (/login, /portal/*, /admin/*) through Netlify rewrites. See ../netlify.toml.
export default defineConfig({
  base: '/portal-app/',
  plugins: [react()],
  build: { outDir: 'dist', sourcemap: false },
})
