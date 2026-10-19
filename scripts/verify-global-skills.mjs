// Real Pi tools, deterministic providers, no live inference or credential retrieval.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRoleRuntime } from '../dist/src/runtime/create-role-runtime.js';
import { fixtureResponse, fixtureToolResponse, fixtureChatResponse, fixtureChatToolResponse } from '../dist/src/security/fixture-provider.js';

const root = await mkdtemp(join(tmpdir(), 'pi-skills-proof-'));
const cwd = join(root, 'workspace'); await mkdir(cwd);
try {
  for (const role of ['A', 'B']) {
    let calls = 0;
    const results = [];
    const binding = await createRoleRuntime({ role, cwd, sessionRoot: join(root, `state-${role}`), sessionMode: 'memory',
      providerTestBackend: { cwd, modelIds: [], load: async () => 'dummy-skills-proof', request: async (_url, init) => {
        calls++;
        if (calls === 1) {
          assert.ok(String(init?.body).includes('setup-matt-pocock-skills'));
          assert.ok(String(init?.body).includes('pstack/poteto-mode'));
        }
        const args = calls === 1 ? {} : { name: calls === 2 ? 'tdd' : 'pstack/poteto-mode' };
        const tool = calls === 1 ? 'list_tools' : 'skills';
        if (calls <= 3) return role === 'A' ? fixtureToolResponse(tool, args) : fixtureChatToolResponse(tool, args);
        return role === 'A' ? fixtureResponse('Skills verified') : fixtureChatResponse('Skills verified');
      } }
    });
    binding.session.subscribe(event => {
      if (event.type === 'tool_execution_end') results.push({ isError: event.isError, content: event.result.content });
    });
    try {
      await binding.session.prompt('List installed skills, then read tdd and pstack/poteto-mode.');
      assert.equal(calls, 4); assert.equal(results.length, 3);
      assert.ok(results.every(result => !result.isError));
      const inventory = JSON.parse(results[0].content.find(item => item.type === 'text').text);
      assert.equal(inventory.skills.status, 'ready');
      const catalog = inventory.skills.skills;
      assert.ok(inventory.tools.some(tool => tool.name === 'skills'));
      assert.ok(inventory.mcp);
      assert.equal(catalog.length, 83);
      assert.equal(catalog.filter(skill => skill.name.startsWith('pstack/')).length, 56);
      assert.ok(catalog.some(skill => skill.name === 'pstack/tdd'));
      assert.ok(catalog.some(skill => skill.name === 'setup-matt-pocock-skills'));
      assert.ok(JSON.stringify(results[1].content).includes('Test-Driven Development'));
      assert.ok(JSON.stringify(results[2].content).includes('poteto'));
      assert.ok(JSON.stringify(results[2].content).includes('Pi host adapter for pstack'));
      console.log(JSON.stringify({ role, installedSkills: catalog.length, startupCatalog: true, combinedInventory: true, pstackPiAdapter: true, tddInstructionsRead: true, pstackInstructionsRead: true, nativeToolResults: results.length, inference: 'fixture', outcome: 'passed' }));
    } finally { await binding.dispose(); }
  }
} finally { await rm(root, { recursive: true, force: true }); }
