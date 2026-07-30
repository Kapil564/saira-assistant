import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    main: './src/main/index.ts',
    'main/preload': './src/main/preload.ts',
    renderer: './src/renderer/index.tsx',
    'db/migrate': './src/db/migrate.ts',
  },
  format: ['cjs'],
  platform: 'node',
  target: 'node20',
  bundle: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  external: ['electron'],
  esbuildOptions: (options) => {
    options.jsx = 'automatic';
  },
});
