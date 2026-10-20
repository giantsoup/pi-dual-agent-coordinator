import { ProcessTerminal } from '@earendil-works/pi-tui';
import { randomUUID } from 'node:crypto';
import { writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { bootstrapRepl } from '../../dist/src/app/bootstrap.js';
import { Coordinator } from '../../dist/src/coordinator/coordinator.js';
import { HeadlessInteractiveCoordinatorService } from '../../dist/src/app/interactive/service.js';
import { createRoleRuntime } from '../../dist/src/runtime/create-role-runtime.js';
import { LmStudioModels } from '../../dist/src/security/lm-studio.js';
import { fixtureResponse, fixtureToolResponse, fixtureChatResponse, fixtureChatToolResponse } from '../../dist/src/security/fixture-provider.js';

const [workspace, stateRoot, mode] = process.argv.slice(2);
if (!workspace || !stateRoot) throw new Error('Supply isolated workspace and state paths.');
const block = (name, data) => `\`\`\`${name}\n${JSON.stringify(data)}\n\`\`\``;
const field = (text, name) => { const value = text.match(new RegExp(`${name}: ([^\\n]+)`))?.[1]; if (!value) throw new Error(`Missing ${name}`); return value; };
const toolResponse = fixtureChatToolResponse;
const options = {command:'repl',cwd:workspace,sessionRoot:stateRoot,sessionMode:'persistent',mcpEnabled:false,jsonLogs:false,verbose:false,maxReviewRounds:2,timeoutMs:15000,plainUi:mode === 'plain' || mode === 'plain-repair'};
const skillDir = join(stateRoot, 'agent', 'skills', 'terminal-fixture');
mkdirSync(skillDir, {recursive:true});
writeFileSync(join(skillDir, 'SKILL.md'), '---\nname: terminal-fixture\ndescription: Terminal skill fixture\n---\nTERMINAL_SKILL_INSTRUCTIONS_OK\n');
options.agentDir = join(stateRoot, 'agent');
const executed = new Set();
const stressCalls = new Map();
const activityCalls = new Map();
let repairScenario;
const localInventory = ['qwen/qwen3.8-27b','qwen3-coder-next','google/gemma-4-e4b'].map((key,index) => ({type:'llm',key,display_name:key,max_context_length:262144,
  capabilities:{trained_for_tool_use:true},loaded_instances:index === 0 ? [{id:key,config:{context_length:65536}}] : []}));
const localModels = new LmStudioModels({request:async (url,init) => {
  if (init.method === 'GET') return Response.json({models:localInventory});
  const body = JSON.parse(init.body);
  if (String(url).endsWith('/unload')) for (const model of localInventory) model.loaded_instances = model.loaded_instances.filter(instance => instance.id !== body.instance_id);
  else {
    await new Promise(resolve => setTimeout(resolve,650));
    const model = localInventory.find(model => model.key === body.model);
    if (!model) return Response.json({}, {status:404});
    model.loaded_instances = [{id:body.model+'-ready',config:{context_length:body.context_length}}];
  }
  return Response.json({});
}});
const coordinator = new Coordinator({...options, localModels, createRoleRuntime: async input => createRoleRuntime({...input,providerTestBackend:{cwd:workspace,modelIds:[],load:async()=>`dummy-${randomUUID()}`,request:async (_url,init) => {
  const body = JSON.parse(String(init.body));
  const promptContent = (body.input ?? body.messages).filter(item => item.role === 'user').at(-1)?.content;
  const prompt = typeof promptContent === 'string' ? promptContent : promptContent?.map(item => item.text ?? '').join('\n') ?? '';
  if (input.role === 'A' && (prompt.includes('List the installed Pi skills using the skills tool') || prompt.includes('Use the installed Pi skill terminal-fixture'))) {
    const latestUser = body.input.findLastIndex(item => item.role === 'user');
    const result = body.input.slice(latestUser).find(item => item.type === 'function_call_output');
    if (result) {
      const marker = prompt.includes('Use the installed Pi skill') ? 'TERMINAL_SKILL_INSTRUCTIONS_OK' : 'terminal-fixture';
      return fixtureResponse(JSON.stringify(result.output).includes(marker) ? `TERMINAL_SKILL_OK ${marker}` : 'TERMINAL_SKILL_FAILURE');
    }
    return fixtureToolResponse('skills', prompt.includes('Use the installed Pi skill') ? {name:'terminal-fixture'} : {});
  }
  if (input.role === 'A' && prompt.includes('Coordinator process check-in')) {
    await new Promise(resolve => setTimeout(resolve, 800));
    return fixtureResponse(block('pi-check-in', {
      schemaVersion:1, workflowId:field(prompt,'Workflow ID'), handoffId:field(prompt,'Handoff ID'),
      iteration:Number(field(prompt,'Iteration')), turnCount:Number(prompt.match(/after (\d+) (?:completed|successful) model turns/)?.[1]),
      decision:'continue', reason:'The fixture is collecting the requested history evidence.', nextSteps:[]
    }));
  }
  if (prompt.includes('provenance="planning_user"') && prompt.includes('repair fixture')) {
    repairScenario = prompt.includes('exhaust repair fixture') ? 'exhaust' : prompt.includes('bounded repair fixture') ? 'bounded' : 'single';
    return fixtureResponse('```pi-plan\n{}\n```');
  }
  if (prompt.includes('provenance="planning_repair"')) {
    await new Promise(resolve => setTimeout(resolve, repairScenario === 'single' ? 600 : 150));
    const attempt = Number(/response attempt (\d+)\/10/.exec(prompt)?.[1]);
    if (repairScenario === 'exhaust' || repairScenario === 'bounded' && attempt < 10) return fixtureResponse('```pi-plan\n{}\n```');
    return fixtureResponse('TERMINAL_REPAIR_OK');
  }
  if (prompt.includes('provider failure')) return new Response('fixture failure',{status:503});
  if (input.role === 'B') {
    const handoff = body.messages.filter(item => item.role === 'user').map(item => typeof item.content === 'string' ? item.content : item.content?.map(part => part.text ?? '').join('\n') ?? '').findLast(text => text.includes('Coordinator handoff for Agent B.')) ?? prompt;
    const workflowId = field(handoff,'Workflow ID');
    const handoffId = field(handoff,'Handoff ID');
    const iteration = Number(field(handoff,'Iteration'));
    if (handoff.includes('activity narrative')) {
      const count = activityCalls.get(handoffId) ?? 0;
      activityCalls.set(handoffId, count + 1);
      await new Promise(resolve => setTimeout(resolve, iteration === 1 ? 160 : 450));
      if (count === 0) return toolResponse('write',{path:'result.txt',content:iteration === 1 ? 'initial' : 'revised'}, `activity-write-${iteration}`, iteration === 1 ? 'I am implementing the approved change.' : 'I am applying the requested revision.');
      if (count < (iteration === 1 ? 12 : 2)) return toolResponse('read',{path:'result.txt'}, `activity-read-${iteration}-${count}`, count === 10 ? 'I am continuing after the senior check-in.' : undefined);
      return fixtureChatResponse('Implementation evidence is ready for review.\n' + block('pi-completion',{schemaVersion:1,workflowId,handoffId,iteration,summary:'Read and write results retained',changedPaths:['result.txt'],verification:['Read result.txt']}));
    }
    if (handoff.includes('history stress')) {
      const count = stressCalls.get(handoffId) ?? 0;
      if (count < 12) {
        stressCalls.set(handoffId, count + 1);
        await new Promise(resolve => setTimeout(resolve, 70));
        return fixtureChatToolResponse('read', {path:count === 4 ? 'missing-stress.txt' : 'evidence.txt'}, `stress-${count}`,
          count === 0 ? 'I am inspecting the retained evidence before making a change.' : count === 11 ? 'The senior check-in is complete. I am checking the remaining evidence.' : undefined);
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
    if (prompt.includes('activity narrative')) {
      await new Promise(resolve => setTimeout(resolve, 1200));
      const iteration = Number(field(prompt,'Current iteration'));
      if (iteration === 1) return fixtureResponse('A revision is required before sign-off.\n' + block('pi-handoff',{schemaVersion:1,workflowId:field(prompt,'Workflow ID'),handoffId:randomUUID(),iteration:2,objective:'activity narrative revision',summary:'Revise the retained result',acceptanceCriteria:['result.txt contains revised'],relevantPaths:['result.txt'],reviewNotes:['Write revised and read the file back']}));
      return fixtureResponse('I reviewed the revision and retained tool evidence.\n' + block('pi-final',{schemaVersion:1,workflowId:field(prompt,'Workflow ID'),iteration,decision:'approved',summary:'Revision approved',userResponse:'TERMINAL_ACTIVITY_OK',changedPaths:['result.txt']}));
    }
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
  if (operator.includes('scroll fixture')) return fixtureResponse(Array.from({length:60},(_,i)=>`SCROLL_LINE_${i}`).join('\n'));
  if (operator.includes('plan')) return fixtureResponse('Plan prose retained.\n' + block('pi-plan',{schemaVersion:1,objective:prompt.includes('activity narrative')?'activity narrative':prompt.includes('history stress')?'history stress':prompt.includes('tool failure')?'tool failure':prompt.includes('cancel-execution')?'cancel-execution':prompt.includes('cancel-review')?'cancel-review':prompt.includes('review cap')?'review cap':'Write fixture result',summary:'Ready',acceptanceCriteria:['result file verified'],relevantPaths:['result.txt'],executionPlan:['Write result.txt','Verify content']}));
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
