import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [
        react(),
        VitePWA({
          registerType: 'autoUpdate',
          injectRegister: null,
          includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'gocanteen-icon.png'],
          manifest: {
            id: '/',
            name: 'Go Canteen',
            short_name: 'Go Canteen',
            description: 'Go Canteen – canteen ordering and management',
            start_url: '/',
            scope: '/',
            display: 'standalone',
            orientation: 'portrait',
            theme_color: '#ffffff',
            background_color: '#ffffff',
            prefer_related_applications: false,
            related_applications: [
              {
                platform: 'play',
                id: 'com.gocanteen.app',
                url: 'https://play.google.com/store/apps/details?id=com.gocanteen.app'
              }
            ],
            icons: [
              { src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
              { src: '/pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
              { src: '/maskable-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
            ]
          },
          workbox: {
            globPatterns: ['**/*.{js,css,html,png,svg,ico}'],
            maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
            navigateFallback: '/index.html',
            navigateFallbackDenylist: [/^\/api\//, /^\/privacy-policy/, /^\/account-deletion/],
            cleanupOutdatedCaches: true,
            clientsClaim: true,
            skipWaiting: true,
            // API / Supabase calls are never cached by the service worker (network only).
            runtimeCaching: [
              { urlPattern: ({ url }) => url.hostname.endsWith('supabase.co') || url.pathname.startsWith('/api/'), handler: 'NetworkOnly' }
            ]
          }
        })
      ],
      define: {
        'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY)
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
