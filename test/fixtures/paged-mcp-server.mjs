import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema, ListResourcesRequestSchema, ListResourceTemplatesRequestSchema, ReadResourceRequestSchema, ListPromptsRequestSchema, GetPromptRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const mode = process.argv[2];
const server = new Server({ name: 'paged-fixture', version: '1.0.0' }, { capabilities: mode === 'resources-only' ? { resources: {} } : { tools: {}, resources: {}, prompts: {} } });
const page = (request, key, item) => ({ [key]: [item(request.params?.cursor === undefined ? 'first' : 'second')], ...(request.params?.cursor === undefined || mode === 'repeat' ? { nextCursor: '' } : {}) });
server.setRequestHandler(ListResourcesRequestSchema, async request => page(request, 'resources', name => ({ name, uri: `fixture:///${name}` })));
server.setRequestHandler(ListResourceTemplatesRequestSchema, async request => page(request, 'resourceTemplates', name => ({ name, uriTemplate: `fixture:///${name}/{id}` })));
const waitForAbort = signal => new Promise(resolve => {
  const timer = setTimeout(resolve, 30_000);
  signal.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
});
server.setRequestHandler(ReadResourceRequestSchema, async (request, extra) => {
  await waitForAbort(extra.signal);
  return { contents: [{ uri: request.params.uri, text: 'finished' }] };
});
if (mode !== 'resources-only') {
  server.setRequestHandler(ListToolsRequestSchema, async request => page(request, 'tools', name => ({ name, inputSchema: { type: 'object', properties: { invalid: { type: 'boolean' } } }, outputSchema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] } })));
  server.setRequestHandler(CallToolRequestSchema, async request => ({ content: [], structuredContent: { ok: request.params.arguments?.invalid ? 'invalid' : true } }));
  server.setRequestHandler(ListPromptsRequestSchema, async request => page(request, 'prompts', name => ({ name })));
  server.setRequestHandler(GetPromptRequestSchema, async (_request, extra) => {
    await waitForAbort(extra.signal);
    return { messages: [{ role: 'user', content: { type: 'text', text: 'finished' } }] };
  });
}
await server.connect(new StdioServerTransport());
