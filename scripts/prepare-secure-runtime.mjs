import { cpSync, existsSync, mkdirSync, realpathSync, writeFileSync, readFileSync, readdirSync, lstatSync, readlinkSync, symlinkSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { resolve, relative, join, dirname, sep } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const source = realpathSync(fileURLToPath(new URL('../', import.meta.url)));
const requested = resolve(process.argv[2] ?? '');
const destination = join(realpathSync(dirname(requested)), requested.slice(dirname(requested).length + 1));
const sourceRelative = relative(source, destination);
if (!process.argv[2] || existsSync(destination) || !(sourceRelative === '..' || sourceRelative.startsWith(`..${sep}`))) {
  throw new Error('Supply a new installation directory outside this checkout and the target workspace. Existing installations are never overwritten.');
}
assert.equal(process.versions.node, '24.22.0', 'Install using the frozen Node 24.22.0 toolchain');
assert.ok(process.env.npm_execpath, 'Run npm run secure:install with npm 12.2.0');
const npmRoot = dirname(dirname(realpathSync(process.env.npm_execpath)));
assert.equal(JSON.parse(readFileSync(join(npmRoot, 'package.json'), 'utf8')).version, '12.2.0');
if (!existsSync(join(source, 'dist/native/credential-store'))) throw new Error('Run npm run build on macOS first.');
mkdirSync(destination, { recursive: true, mode: 0o700 });
const entries = ['dist', 'node_modules', 'src', 'test', 'scripts', 'native', 'package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.check.json', 'vitest.config.ts', '.nvmrc', 'docs', 'examples', 'README.md', 'CONTRIBUTING.md'];
for (const name of entries) cpSync(join(source, name), join(destination, name), { recursive: true, dereference: false, verbatimSymlinks: true });
const browserRuntime = join(homedir(), '.local/share/pi-dual/browser-runtime');
if (existsSync(browserRuntime)) cpSync(browserRuntime, join(destination, 'browser-runtime'), { recursive: true, dereference: false, verbatimSymlinks: true });
mkdirSync(join(destination, 'bin'), { mode: 0o700 });
mkdirSync(join(destination, 'toolchain'), { mode: 0o700 });
cpSync(process.execPath, join(destination, 'bin/node'));
cpSync(npmRoot, join(destination, 'toolchain/npm'), { recursive: true, dereference: false, verbatimSymlinks: true });
symlinkSync('../toolchain/npm/bin/npm-cli.js', join(destination, 'bin/npm'));
symlinkSync('../toolchain/npm/bin/npx-cli.js', join(destination, 'bin/npx'));
function hashes(root, directory = '') {
  const result = {};
  for (const item of readdirSync(join(root, directory), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(directory, item.name);
    const stat = lstatSync(join(root, path));
    if (stat.isDirectory()) Object.assign(result, hashes(root, path));
    else if (stat.isSymbolicLink()) result[path] = { link: readlinkSync(join(root, path)) };
    else result[path] = { sha256: createHash('sha256').update(readFileSync(join(root, path))).digest('hex'), mode: stat.mode & 0o777 };
  }
  return result;
}
if (existsSync(browserRuntime)) assert.deepEqual(hashes(browserRuntime), hashes(join(destination, "browser-runtime")), "Browser runtime copy mismatch");
for (const name of entries) {
  const stat = lstatSync(join(source, name));
  if (stat.isDirectory()) assert.deepEqual(hashes(join(source, name)), hashes(join(destination, name)), `Copy mismatch: ${name}`);
  else assert.deepEqual(readFileSync(join(source, name)), readFileSync(join(destination, name)), `Copy mismatch: ${name}`);
}
writeFileSync(join(destination, 'INSTALLATION.txt'), 'Trusted runtime snapshot. Do not choose this directory or its parent as the agent workspace. Use bin/node and bin/npm. Existing snapshots are preserved. Verify with bin/node scripts/verify-installation.mjs.\n');
const git = args => {
  const result = spawnSync('git', args, { cwd: source, encoding: 'utf8' });
  if (result.status !== 0) throw new Error('Cannot identify source candidate');
  return result.stdout.trim();
};
const manifest = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8'));
const record = { createdAt: new Date().toISOString(), node: process.versions.node, npm: '12.2.0', pi: manifest.dependencies['@earendil-works/pi-coding-agent'], sourceCommit: git(['rev-parse', 'HEAD']), sourceDiffSha256: createHash('sha256').update(git(['diff', '--binary', 'HEAD'])).digest('hex'), files: hashes(destination) };
writeFileSync(join(destination, 'installation-manifest.json'), JSON.stringify(record, null, 2) + '\n', { mode: 0o600 });
process.stdout.write(`Trusted runtime prepared and copy hashes verified at ${destination}\nUse: ${join(destination, 'bin/node')} ${join(destination, 'dist/src/index.js')} doctor /path/to/workspace --no-mcp\n`);
