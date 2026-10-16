// Run from any directory: node docs/research/agent-tui-design/capture-local.mjs
// Captures the real current renderer with synthetic, credential-free state.
import { build } from 'esbuild';
import { TUI, visibleWidth } from '@mariozechner/pi-tui';
import { mkdtemp, symlink, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { stripVTControlCharacters } from 'node:util';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const temp = await mkdtemp(join(tmpdir(), 'pi-tui-design-'));
try {
  await symlink(join(root, 'node_modules'), join(temp, 'node_modules'));
  await build({ entryPoints: [join(root, 'src/app/tui/app.ts')], bundle: true,
    packages: 'external', platform: 'node', format: 'esm', outfile: join(temp, 'app.mjs') });
  const { CoordinatorTuiApp } = await import(pathToFileURL(join(temp, 'app.mjs')).href);
  const time = '2026-10-16T22:00:00.000Z';
  const totals = { reads: 3, searches: 1, listings: 0, writes: 0, edits: 1, commands: 1, mcpCalls: 0, otherTools: 0 };
  const state = {
    status: { cwd: '/fixture/project', conversationMode: 'execution', phase: 'execution',
      phaseLabel: 'Execution', activeRole: 'B', activeRoleLabel: 'Agent B', activeModelDisplay: 'fixture-executor',
      sessionRoot: '(synthetic)', repairCount: 0, maxReviewRounds: 3, activeWorkflowId: 'wf-example', currentIteration: 1,
      workflowStatus: 'executing', currentActivity: 'running npm test', runtimes: ['A', 'B'].map(role => ({role,
        sessionId: `fixture-${role}`, cwd: '/fixture/project', modelDisplay: role === 'A' ? 'fixture-reviewer' : 'fixture-executor', thinking: 'high', healthy: true})), metrics: {} },
    conversation: [
      {id:'1', kind:'operator_message', createdAt:time, text:'Keep tool history visible and let me inspect older calls.'},
      {id:'2', kind:'assistant_planning_response', role:'A', createdAt:time, text:'I will inspect the existing terminal components, then propose a focused change.'},
      {id:'3', kind:'approval_discard', action:'approved', createdAt:time, text:'Approved execution plan.'}
    ],
    activity: { runtimes:{}, history:{ B: { sessionId:'fixture-B', totals, recent: [
      {id:'read-1', text:'reading src/app/tui/app.ts', status:'completed', toolName:'read', toolCallId:'read-1', startedAt:time, updatedAt:time},
      {id:'test-1', text:'running npm test', status:'active', toolName:'bash', toolCallId:'test-1', startedAt:time, updatedAt:time}
    ] } } }, modal:{kind:'none'}, notifications:[], operation:{kind:'running'}, shouldExit:false
  };
  const captures = [];
  for (const [columns, rows] of [[120,40],[80,24]]) {
    for (const activity of [false,true]) {
      const terminal = { columns, rows, kittyProtocolActive:false, write(){}, start(){}, stop(){},
        async drainInput(){}, moveBy(){}, hideCursor(){}, showCursor(){}, clearLine(){}, clearFromCursor(){}, clearScreen(){}, setTitle(){} };
      const tui = new TUI(terminal);
      const service = { getState:()=>state, async dispatch(){}, subscribeState:()=>()=>{} };
      const app = new CoordinatorTuiApp(tui, terminal, service, {onExit(){}});
      app.focused = true;
      if (activity) app.handleInput('\x1bOQ');
      const lines = app.render(columns);
      if (lines.length !== rows || lines.some(line => visibleWidth(line) > columns)) throw new Error('Renderer exceeded terminal bounds');
      const text = lines.map(stripVTControlCharacters).join('\n');
      if (activity && !text.includes('Activity')) throw new Error('F2 did not open Activity');
      captures.push({columns,rows,activity,text});
    }
  }
  const sourceHash = createHash('sha256').update(readFileSync(join(root,'src/app/tui/app.ts'))).digest('hex');
  await writeFile(join(here,'baseline.json'), JSON.stringify({ capturedAt:new Date().toISOString(),
    provenance:'Current source renderer, synthetic state, no provider or credential access. ANSI styling stripped for browser display.', sourceHash,captures},null,2)+'\n');
  console.log('Captured four current-renderer views; exact row counts and visible widths passed.');
} finally { await rm(temp,{recursive:true,force:true}); }
