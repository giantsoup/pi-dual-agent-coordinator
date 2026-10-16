import { ProcessTerminal } from '@mariozechner/pi-tui';
import { randomUUID } from 'node:crypto';
import { writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { bootstrapRepl } from '../../dist/src/app/bootstrap.js';
import { Coordinator } from '../../dist/src/coordinator/coordinator.js';
import { HeadlessInteractiveCoordinatorService } from '../../dist/src/app/interactive/service.js';
import { createRoleRuntime } from '../../dist/src/runtime/create-role-runtime.js';
import { fixtureResponse, fixtureChatResponse, fixtureChatToolResponse } from '../../dist/src/security/fixture-provider.js';

const [workspace, stateRoot, mode] = process.argv.slice(2);
if (!workspace || !stateRoot) throw new Error('Supply isolated workspace and state paths.');
const block = (name, data) => `\`\`\`${name}\n${JSON.stringify(data)}\n\`\`\``;
const field = (text, name) => { const value = text.match(new RegExp(`${name}: ([^\\n]+)`))?.[1]; if (!value) throw new Error(`Missing ${name}`); return value; };
const toolResponse = fixtureChatToolResponse;
const options = {command:'repl',cwd:workspace,sessionRoot:stateRoot,sessionMode:'persistent',mcpEnabled:false,jsonLogs:false,verbose:false,maxReviewRounds:2,timeoutMs:15000,plainUi:mode === 'plain'};
const executed = new Set();
const stressCalls = new Map();
const coordinator = new Coordinator({...options, createRoleRuntime: async input => createRoleRuntime({...input,providerTestBackend:{cwd:workspace,modelIds:[],load:async()=>`dummy-${randomUUID()}`,request:async (_url,init) => {
  const body = JSON.parse(String(init.body));
  const promptContent = (body.input ?? body.messages).filter(item => item.role === 'user').at(-1)?.content;
  const prompt = typeof promptContent === 'string' ? promptContent : promptContent?.map(item => item.text ?? '').join('\n') ?? '';
  if (prompt.includes('provenance="planning_user"') && prompt.includes('repair fixture')) return fixtureResponse('```pi-plan\n{}\n```');
  if (prompt.includes('provenance="planning_repair"')) {
    await new Promise(resolve => setTimeout(resolve,600));
    return fixtureResponse('TERMINAL_REPAIR_OK');
  }
  if (prompt.includes('provider failure')) return new Response('fixture failure',{status:503});
  if (input.role === 'B') {
    const workflowId = field(prompt,'Workflow ID');
    const handoffId = field(prompt,'Handoff ID');
    const iteration = Number(field(prompt,'Iteration'));
    if (prompt.includes('history stress')) {
      const count = stressCalls.get(handoffId) ?? 0;
      if (count < 12) {
        stressCalls.set(handoffId, count + 1);
        await new Promise(resolve => setTimeout(resolve, 70));
        return fixtureChatToolResponse('read', {path:count === 4 ? 'missing-stress.txt' : 'evidence.txt'}, `stress-${count}`);
      }
    } else if (!executed.has(handoffId)) {
      executed.add(handoffId);
      return prompt.includes('cancel-execution') ? toolResponse('bash',{command:'sleep 30; printf LATE > late.txt'}) : prompt.includes('tool failure') ? toolResponse('read',{path:'missing.txt'}) : toolResponse('write',{path:'result.txt',content:'TERMINAL_EXECUTION_OK\n'});
    }
    return fixtureChatResponse('Execution detail retained.\n' + block('pi-completion',{schemaVersion:1,workflowId,handoffId,iteration,summary:'Executed fixture tool',changedPaths:prompt.includes('tool failure')?[]:['result.txt'],verification:['tool request observed']}));
  }
  const capped = prompt.match(/Workflow (\S+) has reached the review cap at iteration (\d+)/);
  if (capped) return fixtureResponse(block('pi-final',{schemaVersion:1,workflowId:capped[1],iteration:Number(capped[2]),decision:'blocked',summary:'Review cap',userResponse:'TERMINAL_REVIEW_CAP',changedPaths:['result.txt']}));
  if (prompt.includes('Coordinator review prompt')) {
    if (prompt.includes('cancel-review')) {
      await new Promise((resolve,reject) => {
        const timer = setTimeout(resolve,5000);
        init.signal?.addEventListener('abort',()=>{clearTimeout(timer);reject(new Error('cancelled'));},{once:true});
      });
    }
    if (prompt.includes('review cap')) return fixtureResponse(block('pi-handoff',{schemaVersion:1,workflowId:field(prompt,'Workflow ID'),handoffId:randomUUID(),iteration:Number(field(prompt,'Current iteration'))+1,objective:'review cap',summary:'Another iteration',acceptanceCriteria:['verify'],relevantPaths:['result.txt'],executionPlan:['Repeat fixture']}));
    if (prompt.includes('history stress')) await new Promise(resolve => setTimeout(resolve, 600));
    return fixtureResponse('Review detail retained.\n' + block('pi-final',{schemaVersion:1,workflowId:field(prompt,'Workflow ID'),iteration:Number(field(prompt,'Current iteration')),decision:prompt.includes('tool failure')?'blocked':'approved',summary:'Verified',userResponse:prompt.includes('tool failure')?'TERMINAL_TOOL_FAILURE':'TERMINAL_WORKFLOW_OK',changedPaths:['result.txt']}));
  }
  if (prompt.includes('slow')) {
    const full = await fixtureResponse('Still working on delayed request.').text();
    const cut = full.indexOf('event: response.output_item.done');
    const encoder = new TextEncoder(); let timer;
    return new Response(new ReadableStream({start(controller) {
      controller.enqueue(encoder.encode(full.slice(0,cut)));
      timer = setTimeout(() => { controller.enqueue(encoder.encode(full.slice(cut)));controller.close(); },2000);
      init.signal?.addEventListener('abort',()=>{clearTimeout(timer);try{controller.error(new Error('cancelled'));}catch{}},{once:true});
    },cancel(){clearTimeout(timer);}}),{headers:{'Content-Type':'text/event-stream'}});
  }
  const operator = prompt.split('\nOperator turn:\n')[1] ?? prompt;
  if (operator.includes('plan')) return fixtureResponse('Plan prose retained.\n' + block('pi-plan',{schemaVersion:1,objective:prompt.includes('history stress')?'history stress':prompt.includes('tool failure')?'tool failure':prompt.includes('cancel-execution')?'cancel-execution':prompt.includes('cancel-review')?'cancel-review':prompt.includes('review cap')?'review cap':'Write fixture result',summary:'Ready',acceptanceCriteria:['result file verified'],relevantPaths:['result.txt'],executionPlan:['Write result.txt','Verify content']}));
  return fixtureResponse('## Discussion\nUnicode 界 😀\n```ts\nconst result = "ok";\n```\nTERMINAL_DISCUSSION_OK');
}}})});
const service = new HeadlessInteractiveCoordinatorService(coordinator);
service.subscribeState(state => {
  writeFileSync(join(stateRoot,'ui-state.next'),JSON.stringify(state));
  renameSync(join(stateRoot,'ui-state.next'),join(stateRoot,'ui-state.json'));
});
class FailingTerminal extends ProcessTerminal {
  start(onInput,onResize) { super.start(onInput,onResize); throw new Error('fixture terminal initialization failure'); }
}
await bootstrapRepl(options,{createService:()=>service,...(mode === 'startup-failure' ? {createTerminal:()=>new FailingTerminal()} : {})});
