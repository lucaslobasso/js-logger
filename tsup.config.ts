import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: { index: 'src/index.ts', react: 'src/react.ts', vue: 'src/vue.ts', angular: 'src/angular.ts' },
    format: ['esm', 'cjs'],
    dts: true,
    target: 'es2019',
    external: ['react', 'vue', '@angular/core'],
  },
  {
    // <script src> build: window.jsLogger = { init, getLogger }
    entry: { 'jsLogger.global': 'src/index.ts' },
    format: ['iife'],
    globalName: 'jsLogger',
    minify: true,
    target: 'es2017',
    outExtension: () => ({ js: '.js' }),
  },
]);
