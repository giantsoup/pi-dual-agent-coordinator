import { cpSync, existsSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { resolve, relative, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const source = realpathSync(fileURLToPath(new URL('../', import.meta.url)));
const destination = resolve(process.argv[2] ?? '');
if (!process.argv[2] || existsSync(destination) || !relative(source, destination).startsWith('..')) {
  throw new Error('Supply a new installation directory outside this checkout and the target workspace. Existing installations are never overwritten.');
}
if (!existsSync(join(source, 'dist/native/credential-store'))) throw new Error('Run npm run build on macOS first.');
mkdirSync(destination, { recursive: true, mode: 0o700 });
for (const name of ['dist', 'node_modules', 'package.json', 'docs', 'README.md']) cpSync(join(source, name), join(destination, name), { recursive: true, dereference: true });
writeFileSync(join(destination,'INSTALLATION.txt'),'Trusted runtime snapshot. Do not choose this directory or its parent as the agent workspace. Rebuild and install into a new directory to update.\n');
process.stdout.write(`Trusted runtime prepared at ${destination}\nUse: node ${join(destination, 'dist/src/index.js')} doctor /path/to/workspace --no-mcp\n`);
