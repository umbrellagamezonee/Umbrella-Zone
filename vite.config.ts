import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// The Windows desktop version (desktop/) loads the app from its own installed
// files and has no use for the browser install / offline-cache machinery.
const desktop = process.env.CUEBILL_DESKTOP === "1"

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    !desktop && VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/favicon-32.png', 'icons/apple-touch-icon.png'],
      manifest: {
        name: 'CueBill',
        short_name: 'CueBill',
        description: 'Gaming cafe billing, sessions, canteen and credit management',
        theme_color: '#0a0612',
        background_color: '#0a0612',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: '/icons/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // App data lives in localStorage, not network responses — just cache
        // the app shell so it opens instantly / offline, nothing dynamic.
        globPatterns: ['**/*.{js,css,html,svg,png,ico}'],
      },
    }),
  ],
})
