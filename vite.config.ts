import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    rollupOptions: {
      // Three.js を別チャンクにして、ゲームのコードだけ変えたときに再ダウンロードしないようにする。
      output: { manualChunks: { three: ['three'] } }
    },
    // Three.js のチャンクだけで約 700KB ある。
    chunkSizeWarningLimit: 800
  }
});
