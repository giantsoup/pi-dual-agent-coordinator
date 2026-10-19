// Uses real MCP and Pi sessions with deterministic providers. Never retrieves an inference key.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { loadResolvedMcpConfig } from '../dist/src/mcp/config-loader.js';
import { McpClientPool } from '../dist/src/mcp/client-pool.js';
import { createRoleRuntime } from '../dist/src/runtime/create-role-runtime.js';
import { fixtureResponse, fixtureToolResponse, fixtureChatResponse, fixtureChatToolResponse } from '../dist/src/security/fixture-provider.js';

const root = await mkdtemp(join(tmpdir(), 'pi-global-mcp-proof-'));
const cwd = join(root, 'workspace');
await mkdir(cwd);
try {
  const discovered = await loadResolvedMcpConfig({ cwd, agentDir: process.env.PI_CODING_AGENT_DIR ?? join(homedir(), '.pi/agent'), enabled: true });
  assert.ok(!discovered.servers.some(server => server.name === 'node_repl'), 'node_repl must stay excluded');
  const server = discovered.servers.find(server => server.name === 'openaiDeveloperDocs');
  assert.ok(server, 'Configure openaiDeveloperDocs in the global MCP config first');
  for (const role of ['A', 'B']) {
    const config = { ...discovered, projectRoot: cwd, cacheFile: join(root, `cache-${role}.json`), servers: [server] };
    const pool = new McpClientPool(role, config);
    let tools;
    try { tools = (await pool.syncMetadata(server.name)).tools; }
    finally { await pool.closeAll(); }
    assert.ok(tools.some(tool => tool.name === 'search_openai_docs'));
    let calls = 0;
    const toolResults = [];
    const args = { action: 'call_tool', server: server.name, tool: 'search_openai_docs', arguments: { query: 'Responses API tools', limit: 1 } };
    const binding = await createRoleRuntime({ role, cwd, sessionRoot: join(root, `state-${role}`), sessionMode: 'memory', mcp: config,
      providerTestBackend: { cwd, modelIds: [], load: async () => 'dummy-global-mcp-proof', request: async () => {
        calls++;
        const call = (name, arguments_) => role === 'A' ? fixtureToolResponse(name, arguments_) : fixtureChatToolResponse(name, arguments_);
        if (calls === 1) return call('list_tools', {});
        if (calls === 2) return call('search_openai_docs', args.arguments);
        if (calls === 3) return call('mcp', args);
        return role === 'A' ? fixtureResponse('MCP verified') : fixtureChatResponse('MCP verified');
      } }
    });
    binding.session.subscribe(event => {
      if (event.type === 'tool_execution_end') toolResults.push(event);
    });
    try {
      await binding.session.prompt('Search the configured global documentation MCP server once.');
      assert.equal(calls, 4);
      assert.equal(toolResults.length, 3);
      assert.deepEqual(toolResults.map(event => event.toolName), ['list_tools', 'search_openai_docs', 'mcp']);
      for (const event of toolResults) {
        assert.equal(event.isError, false);
        assert.notEqual(event.result.isError, true);
      }
      const inventory = JSON.parse(toolResults[0].result.content.find(item => item.type === 'text').text);
      const search = inventory.tools.find(tool => tool.name === 'search_openai_docs');
      assert.ok(search?.parameters.properties.query);
      assert.ok(!inventory.tools.some(tool => tool.name === 'multi_tool_use.parallel'));
      for (const event of toolResults.slice(1)) assert.ok(JSON.stringify(event.result.content).includes('developers.openai.com'));
      console.log(JSON.stringify({ role, server: server.name, tools: tools.map(tool => tool.name), nativeToolResults: toolResults.length, directAndProxy: true, realMcp: true, inference: 'fixture', outcome: 'passed' }));
    } finally { await binding.dispose(); }
  }
} finally { await rm(root, { recursive: true, force: true }); }
