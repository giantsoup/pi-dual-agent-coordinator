import { readFile, writeFile, mkdir, rename, lstat, realpath, copyFile, constants, chmod } from 'node:fs/promises';
import { dirname } from 'node:path';
import { browserConfigPath, browserConfigSchema, validateLocalOrigin } from '../dist/src/browser/policy.js';

const [project, ...origins] = process.argv.slice(2);
if (!project || !origins.length) throw new Error('Usage: npm run browser:allow -- /absolute/project http://localhost:5173 [http://project.test]');
const workspace = await realpath(project);
for (const origin of origins) validateLocalOrigin(origin);
let config = { version: 2, enabled: true, projects: [] };
try {
  const stat = await lstat(browserConfigPath);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== process.getuid() || (stat.mode & 0o077)) throw new Error('Browser policy must be a private operator-owned regular file.');
  const existing = JSON.parse(await readFile(browserConfigPath, 'utf8'));
  if (existing.version === 1) {
    const backup = `${browserConfigPath}.v1-${Date.now()}.backup`;
    await copyFile(browserConfigPath, backup, constants.COPYFILE_EXCL); await chmod(backup, 0o600);
    console.log(`Preserved legacy global origins in ${backup}. Project grants are configured explicitly.`);
  } else config = browserConfigSchema.parse(existing);
} catch (error) { if (error.code !== 'ENOENT') throw error; }
const current = config.projects.find(item => item.workspace === workspace);
if (current) current.allowedOrigins = [...new Set([...current.allowedOrigins, ...origins])];
else config.projects.push({ workspace, allowedOrigins: [...new Set(origins)] });
config.enabled = true;
browserConfigSchema.parse(config);
await mkdir(dirname(browserConfigPath), { recursive: true, mode: 0o700 });
const temporary = `${browserConfigPath}.${process.pid}.tmp`;
await writeFile(temporary, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
await rename(temporary, browserConfigPath);
console.log(`Local project browser configured for ${workspace}. Restart Pi to load the grant.`);
