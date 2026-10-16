import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
if (process.platform === 'darwin') {
  mkdirSync(new URL('../dist/native/', import.meta.url), { recursive: true });
  const result = spawnSync('/usr/bin/clang', ['-fobjc-arc', '-O2', '-framework', 'AppKit', '-framework', 'Security', '-framework', 'LocalAuthentication',
    new URL('../native/credential-store.m', import.meta.url).pathname, '-o',
    new URL('../dist/native/credential-store', import.meta.url).pathname], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(1);
}
