import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { transformWithEsbuild } from 'vite';
import react from '@vitejs/plugin-react';

const root = path.dirname(fileURLToPath(import.meta.url));

// Components use JSX inside .js files (e.g. src/components/ProtectedRoute.js),
// matching the Next.js compiler. Vite only parses JSX in .jsx by default, so
// transform src/**/*.js through esbuild's jsx loader (the recipe from the Vite
// docs for JSX-in-.js codebases).
const jsxInJs = {
  name: 'treat-src-js-as-jsx',
  async transform(code, id) {
    if (!/\/src\/.*\.js$/.test(id)) return null;
    return transformWithEsbuild(code, id, { loader: 'jsx', jsx: 'automatic' });
  },
};

// Component-test harness only (npm run test:components). The pure-module
// suite stays on node --test (npm test) and is untouched by this config —
// `include` is scoped to tests/components/ so vitest never picks up the
// flat tests/*.test.mjs files.
export default defineConfig({
  plugins: [jsxInJs, react()],
  resolve: {
    alias: {
      '@': path.resolve(root, 'src'),
    },
  },
  test: {
    environment: 'jsdom',
    include: ['tests/components/**/*.test.jsx'],
    setupFiles: ['tests/components/setup.mjs'],
  },
});
