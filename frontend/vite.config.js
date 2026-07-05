import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Explicit long-lived cache hint for static image assets (public/*.png etc)
// on repeat visits. Scoped to images only — deliberately NOT applied to
// JS/CSS/HTML, since aggressively caching those would fight Vite's dev
// server / HMR. Note this only affects `npm run dev`; a production
// deployment's actual Cache-Control headers are set by whatever static host
// serves the built dist/ folder, which is outside this repo's config.
const cacheImageAssets = () => ({
  name: 'cache-image-assets',
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      if (req.url && /\.(png|jpe?g|webp|svg)$/i.test(req.url.split('?')[0])) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
      }
      next()
    })
  },
})

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), cacheImageAssets()],
  server: {
    host: true,
  },
})
