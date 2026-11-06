import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const apiPort = process.env.PORT ?? env.PORT ?? '3001';
  return {
    plugins: [react()],
    build: { outDir: 'dist' },
    server: { proxy: { '/api': `http://127.0.0.1:${apiPort}` } },
  };
});
