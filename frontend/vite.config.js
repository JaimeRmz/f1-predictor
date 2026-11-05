import fs from 'node:fs'
import path from 'node:path'
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

// The untracked dev replay files (frontend/public/replay-dev/, written by backend/scripts/build_replay.py) are for `npm run dev` only:
// keep them out of a production build so a local build can never ship them. Production reads VITE_REPLAY_BASE_URL instead.
const stripReplayDev = () => {
  let out = ''
  return {
    name: 'strip-replay-dev',
    apply: 'build',
    configResolved(cfg) { out = path.resolve(cfg.root, cfg.build.outDir) },
    closeBundle() { if (out) fs.rmSync(path.join(out, 'replay-dev'), { recursive: true, force: true }) },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), cacheImageAssets(), stripReplayDev()],
  server: {
    host: true,
    // Allow serving the repo-root data/ dir (one level above this Vite root) so
    // the strategy JSON can be loaded on-demand via import.meta.glob('../../data/...').
    fs: { allow: ['..'] },
  },
})
