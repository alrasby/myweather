import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [tailwindcss(), react()],
  resolve: { alias: [
    { find: '@/weather/proxy.functions', replacement: fileURLToPath(new URL('./src/android/services.ts', import.meta.url)) },
    { find: '@/weather/storms.functions', replacement: fileURLToPath(new URL('./src/android/services.ts', import.meta.url)) },
    { find: '@/weather/cyclone.functions', replacement: fileURLToPath(new URL('./src/android/services.ts', import.meta.url)) },
    { find: '@', replacement: fileURLToPath(new URL('./src', import.meta.url)) },
  ] },
  build: { outDir: 'www', emptyOutDir: true },
});
