import { defineConfig } from 'vite'
import pkg from './package.json';

export default defineConfig({
  base: '/LegitScriptEditor/',
  build: {
    outDir: 'dist/prod',
    assetsDir: 'assets',
    minify: 'terser',
    rollupOptions: {
      output: {
        entryFileNames: `${pkg.name}.${pkg.version}.js`, // or `parser.[hash].js`
        chunkFileNames: `${pkg.name}.${pkg.version}.js`, // use this for dynamic imports
        assetFileNames: `${pkg.name}.${pkg.version}.[ext]`, // or `parser.[hash].[ext]`
      },
    }
  }
});
