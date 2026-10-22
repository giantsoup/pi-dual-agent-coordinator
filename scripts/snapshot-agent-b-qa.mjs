// Capture tracked and required untracked files without touching the index or working tree.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join, dirname, relative, sep } from 'node:path';
const source = process.cwd();
const destination = resolve(process.argv[2] ?? '');
assert(process.argv[2] && !existsSync(destination), 'Supply a new QA directory');
assert(relative(source, destination).startsWith(`..${sep}`), 'QA must be outside the source checkout');
const git = args => execFileSync('git', args, { cwd: source });
const paths = [...new Set(git(['ls-files', '--cached', '--others', '--exclude-standard', '-z']).toString().split('\0').filter(Boolean))].sort();
mkdirSync(destination, { recursive: true });
const files = {};
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
for (const name of paths) {
  if (!existsSync(join(source, name))) continue;
  mkdirSync(dirname(join(destination, name)), { recursive: true });
  cpSync(join(source, name), join(destination, name), { dereference: false, verbatimSymlinks: true });
  files[name] = hash(readFileSync(join(source, name)));
  assert.equal(hash(readFileSync(join(destination, name))), files[name], name);
}
// The installer needs commit/diff provenance. An independent .git copy keeps QA mutations isolated.
cpSync(join(source, '.git'), join(destination, '.git'), { recursive: true, dereference: false });
writeFileSync(join(destination, 'qa-snapshot.json'), JSON.stringify({ commit: git(['rev-parse', 'HEAD']).toString().trim(), files }, null, 2));
writeFileSync(join(destination, 'qa-starting.diff'), git(['diff', '--binary']));
writeFileSync(join(destination, 'qa-starting-status.txt'), git(['status', '--short']));
console.log(JSON.stringify({ destination, hashComparedFiles: paths.length }));
