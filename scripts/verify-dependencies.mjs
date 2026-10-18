import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { builtinModules, createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = path => JSON.parse(readFileSync(join(root, path), 'utf8'));
const manifest = read('package.json');
const lock = read('package-lock.json');
const declared = { ...manifest.dependencies, ...manifest.devDependencies };
const compiler = read('tsconfig.json').compilerOptions;
for (const option of ['strict', 'noUncheckedIndexedAccess', 'exactOptionalPropertyTypes', 'useUnknownInCatchVariables', 'verbatimModuleSyntax', 'noUnusedLocals', 'noUnusedParameters']) {
  assert.equal(compiler[option], true, `Keep ${option} enabled`);
}
assert.equal(compiler.module, 'NodeNext');
assert.equal(compiler.moduleResolution, 'NodeNext');
assert.equal(manifest.packageManager, 'npm@12.2.0');
assert.equal(manifest.engines.node, '>=24.22.0 <25');
assert.equal(manifest.engines.npm, '>=12.2.0 <13');
assert.deepEqual(manifest.allowScripts, { '@google/genai@2.21.0': true, 'protobufjs@7.6.6': true, fsevents: false }, 'Review lifecycle script changes explicitly');
assert.match(process.versions.node, /^24\./);
assert.ok(Number(process.versions.node.split('.')[1]) >= 22, 'Use the frozen supported Node toolchain');
assert.match(process.env.npm_config_user_agent ?? '', /^npm\/12\.2\.0 /, 'Run with the frozen npm: npm run verify:dependencies');
for (const [name, version] of Object.entries(declared)) {
  assert.match(version, /^\d+\.\d+\.\d+$/, `Pin ${name} exactly`);
  assert.equal(lock.packages[`node_modules/${name}`]?.version, version, `Lock mismatch: ${name}`);
  assert.equal(read(`node_modules/${name}/package.json`).version, version, `Installation mismatch: ${name}`);
}
const pi = Object.entries(declared).filter(([name]) => name.startsWith('@earendil-works/pi-'));
assert.equal(pi.length, 4);
assert.ok(pi.every(([, version]) => version === declared['@earendil-works/pi-coding-agent']));
for (const path of Object.keys(lock.packages)) assert.ok(!path.includes('@mariozechner/pi-'), `Legacy Pi family: ${path}`);
const builtins = new Set(builtinModules.flatMap(name => [name, `node:${name}`]));
let files = 0; const imports = new Set();
function inspect(path) {
  files++;
  const source = readFileSync(join(root, path), 'utf8');
  if (path.startsWith('src/')) {
    for (const obsolete of [/\bz\.ZodIssueCode\b/, /\bz\.string\(\)\.url\(/, /\.strict\(\)/, /\btransport\.onclose\s*=/]) {
      assert.ok(!obsolete.test(source), `Obsolete dependency pattern ${obsolete} in ${path}`);
    }
  }
  for (const match of source.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|^\s*import\s*|\brequire\s*\(\s*)["']([^"']+)["']/gm)) {
    const specifier = match[1];
    assert.ok(!specifier.startsWith("@mariozechner/pi-") && !specifier.startsWith("@sinclair/typebox"), `Legacy import in ${path}`);
    assert.notEqual(specifier, "@earendil-works/pi-ai/compat", `Obsolete global adapter in ${path}`);
    if (specifier.startsWith('.') || specifier.startsWith('/') || builtins.has(specifier)) continue;
    const name = specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0];
    assert.ok(name in declared, `Undeclared direct import ${name} in ${path}`);
    imports.add(name);
  }
}
function visit(directory) {
  for (const entry of readdirSync(join(root, directory), { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) visit(path);
    else if (/\.(?:[cm]?js|tsx?)$/.test(path)) inspect(path);
  }
}
for (const directory of ['src', 'test', 'scripts', 'examples']) visit(directory);
inspect('vitest.config.ts');
const require = createRequire(import.meta.url);
const tsPlatform = `@typescript/typescript-${process.platform}-${process.arch}`;
assert.ok(existsSync(require.resolve(`${tsPlatform}/package.json`)), 'Native TypeScript platform package is required');
process.stdout.write(`${JSON.stringify({ outcome: 'passed', sourceFiles: files, directImports: [...imports].sort(), pi: pi[0][1], node: process.versions.node, npm: '12.2.0', typebox: declared.typebox })}\n`);
