import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: '/lutbox/',
  build: {
    target: 'es2020',
    cssMinify: true,
    reportCompressedSize: true,
    // Vite otherwise injects a polyfill that calls fetch() on modulepreload
    // links. There is a single chunk and no dynamic imports here, so it would
    // never have anything to fetch, and the bundle should contain no network
    // call at all rather than a dormant one.
    modulePreload: { polyfill: false },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Parsing a 128 point table is two million lines of text and is meant to
    // be slow. Five seconds is not enough headroom on a shared CI runner.
    testTimeout: 30000,
  },
});
