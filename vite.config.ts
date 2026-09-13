import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  base: '/khata-web/',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'favicon-32.png', 'apple-touch-icon.png', 'icon-192.png', 'icon-512.png'],
      manifest: {
        id: '/khata-web/',
        name: 'Khata — Private credit ledger',
        short_name: 'Khata',
        description: 'Local-first credit ledger. Track customers, dues, and payments offline.',
        theme_color: '#5b65d8',
        background_color: '#f7f8fc',
        display: 'standalone',
        display_override: ['window-controls-overlay', 'standalone', 'minimal-ui'],
        orientation: 'portrait',
        start_url: './',
        scope: './',
        lang: 'en',
        dir: 'ltr',
        categories: ['finance', 'business', 'productivity'],
        prefer_related_applications: false,
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        screenshots: [
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', form_factor: 'narrow' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', form_factor: 'wide' },
        ],
        shortcuts: [
          {
            name: 'Add customer',
            short_name: 'Add',
            description: 'Create a new party in your khata',
            url: './#/?new=1',
            icons: [{ src: 'icon-192.png', sizes: '192x192' }],
          },
          {
            name: 'Reports',
            short_name: 'Reports',
            description: 'This month and overdue collections',
            url: './#/reports',
            icons: [{ src: 'icon-192.png', sizes: '192x192' }],
          },
          {
            name: 'Sync devices',
            short_name: 'Sync',
            description: 'Move your ledger between mobile and laptop',
            url: './#/sync',
            icons: [{ src: 'icon-192.png', sizes: '192x192' }],
          },
        ],
        // Makes the installed app reuse its window instead of opening a
        // second one, and lets shared text land in the ledger.
        launch_handler: { client_mode: 'focus-existing' },
        share_target: {
          action: './#/share',
          method: 'GET',
          params: { title: 'title', text: 'text', url: 'url' },
        },
      } as never,
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,webmanifest}'],
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
        runtimeCaching: [
          {
            urlPattern: ({ request }) => request.destination === 'document' || request.mode === 'navigate',
            handler: 'NetworkFirst',
            options: { cacheName: 'khata-pages', networkTimeoutSeconds: 3 },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
})
