import react from '@vitejs/plugin-react'
import QRCode from 'qrcode'
import { defineConfig, type Plugin } from 'vite'

/** `npm run mobile`: print the phone address (same Wi-Fi) as a QR code to scan. */
function phoneQr(): Plugin {
  return {
    name: 'phone-qr',
    apply: 'serve',
    configureServer(server) {
      server.httpServer?.once('listening', () => {
        // resolvedUrls is filled in just after 'listening'
        setTimeout(async () => {
          const url = server.resolvedUrls?.network[0]
          if (!url) return
          const qr = await QRCode.toString(url, { type: 'terminal', small: true })
          server.config.logger.info(`\n  Scan with your phone (same Wi-Fi): ${url}\n\n${qr}`)
        }, 100)
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), phoneQr()],
})
