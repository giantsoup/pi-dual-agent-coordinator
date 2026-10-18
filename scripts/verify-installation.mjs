import assert from 'node:assert/strict';
import { readFileSync, readlinkSync, lstatSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const manifest = JSON.parse(readFileSync(join(root, 'installation-manifest.json'), 'utf8'));
function inventory(directory = '') {
  const files = [];
  for (const item of readdirSync(join(root, directory), { withFileTypes: true })) {
    const path = join(directory, item.name);
    if (path === 'installation-manifest.json' || path === 'test-results') continue;
    if (item.isDirectory()) files.push(...inventory(path)); else files.push(path);
  }
  return files.sort();
}
assert.deepEqual(inventory(), Object.keys(manifest.files).sort(), 'Unexpected or missing installation files');
for (const [name, expected] of Object.entries(manifest.files)) {
  const path = join(root, name);
  if ('link' in expected) assert.equal(readlinkSync(path), expected.link, `Changed link: ${name}`);
  else {
    assert.equal(createHash('sha256').update(readFileSync(path)).digest('hex'), expected.sha256, `Changed bytes: ${name}`);
    assert.equal(lstatSync(path).mode & 0o777, expected.mode, `Changed mode: ${name}`);
  }
}
assert.equal(process.versions.node, manifest.node);
process.stdout.write(`${JSON.stringify({ outcome: 'passed', filesVerified: Object.keys(manifest.files).length, node: manifest.node, npm: manifest.npm, pi: manifest.pi, sourceCommit: manifest.sourceCommit })}\n`);
