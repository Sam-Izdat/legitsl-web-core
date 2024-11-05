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
        entryFileNames: `LegitScriptWasm.js`, // or `parser.[hash].js`
        chunkFileNames: `LegitScriptWasm.js`, // use this for dynamic imports
        assetFileNames: `LegitScriptWasm.[ext]`, // or `parser.[hash].[ext]` or `${pkg.name}.${pkg.version}.[ext]`
      },
    }
  }
});