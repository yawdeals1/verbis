import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      workbox: {
        // Offline listening (PRODUCT_PLAN.md §5 Phase 3): once a chunk's
        // audio is generated it never changes, so cache it aggressively.
        // Document detail (text + timing_data) is cached too so highlighting
        // still works offline; falls back to network first since it can
        // change (new chunks finishing generation, position updates).
        runtimeCaching: [
          {
            urlPattern: ({ url }: { url: URL }) => /\/documents\/[^/]+\/chunks\/\d+\/audio$/.test(url.pathname),
            handler: 'CacheFirst',
            options: {
              cacheName: 'verbis-chunk-audio',
              expiration: { maxEntries: 500, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [200] },
            },
          },
          {
            urlPattern: ({ url }: { url: URL }) => /\/documents\/[^/]+$/.test(url.pathname),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'verbis-document-detail',
              expiration: { maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [200] },
              networkTimeoutSeconds: 3,
            },
          },
        ],
      },
      manifest: {
        name: 'Verbis',
        short_name: 'Verbis',
        description: 'Read-aloud app for PDFs, Word docs, and scanned books with synced highlighting.',
        theme_color: '#111111',
        background_color: '#111111',
        display: 'standalone',
        start_url: '/',
        icons: [
          {
            src: 'icons.svg',
            sizes: 'any',
            type: 'image/svg+xml',
          },
        ],
      },
    }),
  ],
})
