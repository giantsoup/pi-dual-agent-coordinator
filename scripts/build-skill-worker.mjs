// Bundle the public skill reader without loading Pi's unrelated session/provider
// modules in every sandboxed metadata request. No dependency internals are imported.
import { isBuiltin } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const root = fileURLToPath(new URL('../', import.meta.url));
await build({
  root, configFile: false, logLevel: 'warn',
  build: {
    ssr: true, target: 'node24', minify: false, sourcemap: true,
    outDir: 'dist/src/tools', emptyOutDir: false,
    lib: { entry: 'src/tools/skills.ts', formats: ['es'], fileName: 'skills' },
    rolldownOptions: {
      external: id => isBuiltin(id) || (!id.startsWith('.') && !id.startsWith('/') &&
        !['@earendil-works/pi-coding-agent', 'yaml', 'ignore'].includes(id)),
      treeshake: { moduleSideEffects: false }
    }
  },
  ssr: { noExternal: ['@earendil-works/pi-coding-agent', 'yaml', 'ignore'] }
});
