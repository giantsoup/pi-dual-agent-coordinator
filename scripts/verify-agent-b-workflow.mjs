// Full live A/B gate. Uses the normal interactive /approve command, never model approval.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { Coordinator } from '../dist/src/coordinator/coordinator.js';
import { HeadlessInteractiveCoordinatorService } from '../dist/src/app/interactive/service.js';
import { createRoleRuntime } from '../dist/src/runtime/create-role-runtime.js';
import { credentialStatus } from '../dist/src/security/credentials.js';
import { LmStudioModels } from '../dist/src/security/lm-studio.js';
import { loadCoordinatorConfig, resolveEffectiveModelB, resolveEffectiveThinkingB } from '../dist/src/app/coordinator-config.js';
import { readNativeEvidence } from '../dist/src/coordinator/native-verification.js';
import { SessionLedger } from '../dist/src/persistence/session-ledger.js';
import { safeDisplayText } from '../dist/src/security/display-text.js';
await import('./verify-installation.mjs');
const args=process.argv.slice(2);
const option=key=>args[args.indexOf(key)+1];
assert(args.includes('--output'), 'Supply a new --output directory outside the installation');
const installation=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const output=resolve(option('--output'));assert(!output.startsWith(installation+'/'),'Reports must stay outside the trusted installation');await mkdir(output,{recursive:false,mode:0o700});
const cwd=args.includes('--workspace')?resolve(option('--workspace')):await mkdtemp(join(tmpdir(),'pi-live-workflow-'));
await mkdir(cwd,{recursive:true,mode:0o700});
const allowed=['pass','fail','repair','compaction'];
assert(!cwd.startsWith(installation+'/')&&!output.startsWith(cwd+'/')&&!cwd.startsWith(output+'/'),'Keep workspace, state, and trusted installation separate');
const existing=await readdir(cwd);
if(existing.length)assert.equal(JSON.parse(await readFile(join(cwd,'.workflow-benchmark.json'),'utf8')).purpose,'agent-b-reliability');
else await writeFile(join(cwd,'.workflow-benchmark.json'),JSON.stringify({purpose:'agent-b-reliability'}));
assert((await readdir(cwd)).every(name=>allowed.includes(name)||name==='.workflow-benchmark.json'), 'Use a disposable workspace containing only benchmark scenario directories');
async function fingerprints(directory,prefix='') {
  const entries=await readdir(directory,{withFileTypes:true}); const result={};
  for(const entry of entries) {
    const path=join(prefix,entry.name);
    assert(!entry.isSymbolicLink(),'Unexpected benchmark symlink');
    if(entry.isDirectory())Object.assign(result,await fingerprints(join(directory,entry.name),path));
    else result[path]=createHash('sha256').update(await readFile(join(directory,entry.name))).digest('hex');
  }
  return result;
}
const results=[];
const record=async()=>writeFile(join(output,'workflow-results.json'),JSON.stringify({workspace:cwd,deadlineMs:300000,results,qualified:false,activation:false},null,2));
if(!await credentialStatus(cwd)) {
  results.push({outcome:'blocked',gate:'full-live-workflow',prerequisite:'An available project-scoped Keychain credential for this disposable workspace. Use private setup from the verified installation; never copy a key into a report.',scenariosUnrun:allowed});
  await record();console.log(JSON.stringify({outcome:'blocked',workspace:cwd,report:join(output,'workflow-results.json'),prerequisite:'Private Keychain setup for the disposable workspace'}));process.exitCode=1;
} else {
  const config=await loadCoordinatorConfig();assert.equal(config.warnings.length,0);
  const canonicalB=resolveEffectiveModelB({},config.config).value;
  const host=new LmStudioModels();
  const local=(await host.listModels()).find(item=>canonicalB===`lm-studio/${item.model.id}`||canonicalB===item.model.id);
  assert(local?.loaded&&!local.disabledReason,'The saved executor must already be loaded');
  // A metadata-only host prevents startup from loading, unloading, or saving models.
  const loadedOnly={listModels:signal=>host.listModels(signal),prepare:async(target)=>{
    const current=(await host.listModels()).find(item=>item.model.id===target);
    assert(current?.loaded&&!current.disabledReason&&current.model.id===local.model.id,'Saved executor changed');
    return {model:current.model,commit(){},async rollback(){}};
  }};
  for(const scenario of allowed) {
    const directory=join(cwd,scenario);await mkdir(directory,{recursive:true});
    const test=`import test from 'node:test'; import assert from 'node:assert/strict'; ${scenario==='repair'?"import {value} from './value.mjs';":""} test('ascending assertion',()=>assert.equal(${scenario==='repair'?'value':'1'},${scenario==='fail'?'2':'1'}));\n`;
    await writeFile(join(directory,'check.test.mjs'),test);
    if(scenario==='repair')await writeFile(join(directory,'value.mjs'),'export const value = 2;\n');
    const before=await fingerprints(cwd);
    const command=`node --test --test-reporter=tap ${scenario}/check.test.mjs`;
    const item={scenario,command,deadlineMs:300000,events:[],calls:[],operatorApproval:false};results.push(item);await record();
    const coordinator=new Coordinator({cwd,sessionRoot:join(output,scenario+'-state'),sessionMode:'memory',jsonLogs:false,verbose:false,mcpEnabled:false,browser:false,timeoutMs:300000,
      ...(config.config?.defaults?.modelA?{modelA:config.config.defaults.modelA}:{}),...(config.config?.defaults?.thinkingA?{thinkingA:config.config.defaults.thinkingA}:{}),
      modelB:canonicalB,thinkingB:resolveEffectiveThinkingB({},config.config).value,localModels:loadedOnly,
      createRoleRuntime:options=>{
        if(scenario!=='compaction'||options.role!=='B')return createRoleRuntime(options);
        const manager=SessionManager.inMemory(cwd);
        manager.appendMessage({role:'user',content:'Synthetic benchmark context. This contains no native execution evidence. '+ 'Preserve the approved scope and report only current native results. '.repeat(16000),timestamp:1});
        return createRoleRuntime({...options,initialSessionManager:manager});
      }});
    const service=new HeadlessInteractiveCoordinatorService(coordinator);
    coordinator.subscribeEvents(event=>{
      if(event.eventType==='pi.tool_execution_start')item.calls.push({name:event.details.toolName,id:event.details.toolCallId});
      if(/^(provider\.|compaction\.|workflow\.finalized|ui\.turn_finished)/.test(event.eventType))item.events.push({eventType:event.eventType,runId:event.runId,requestId:event.requestId,timestamp:event.timestamp,details:event.eventType.startsWith('provider.')?event.details:{outcome:event.details.outcome,decision:event.details.decision}});
    });
    const started=performance.now();
    const timer=setTimeout(()=>{item.deadlineExpired=true;void coordinator.cancelActive("timed_out").catch(()=>{item.cancellationCleanup='failed';});},300000);
    try {
      await service.start();
      await service.dispatch({type:'submit_input',input:`Prepare a precise plan for ${scenario}. ${scenario==='repair'?`Repair only ${scenario}/value.mjs so value is 1, then verify.`:'Verification only; no repairs, diagnosis, or reruns.'} Read ${scenario}/check.test.mjs once and run exactly ${command} once. Report the observed command, exit code, available test totals and assertion differences. Stop after reporting, including on a nonzero exit. ${scenario==='fail'?'Successful completion means accurately reporting the deliberately failed check, not application correctness.':''} Put all steps and constraints in pi-plan and wait for /approve.`});
      assert(service.getState().pendingPlan,'Live A must produce a plan waiting for operator /approve');assert.equal(item.calls.length,0);
      item.operatorApproval=true;
      await service.dispatch({type:'submit_input',input:'/approve'});
      const state=service.getState();item.operation=state.operation?.kind;
      item.finalMessages=state.conversation.filter(entry=>entry.role==='assistant').map(entry=>safeDisplayText(entry.text).slice(0,8000));
      const ledger=new SessionLedger(join(output,scenario+'-state','ledger','handoffs.jsonl'));
      const entries=await ledger.loadAll();
      const completed=entries.findLast(entry=>entry.status==='completed');
      item.nativeEvidence=readNativeEvidence(completed?.details);
      item.finalDecision=entries.findLast(entry=>entry.status==='finalized')?.finalDecision;
      const check=item.nativeEvidence?.observations.find(entry=>entry.toolName==='bash'&&entry.command===command);
      item.observedExpectedExit=check?.exitCode===(scenario==='fail'?1:0);
      item.compactionObserved=item.events.some(event=>event.eventType==='compaction.completed');
      item.testFileUnchanged=await readFile(join(directory,'check.test.mjs'),'utf8')===test;
      const after=await fingerprints(cwd);
      item.changedFiles=[...new Set([...Object.keys(before),...Object.keys(after)])].filter(path=>before[path]!==after[path]);
      item.unexpectedChanges=item.changedFiles.some(path=>scenario!=='repair'||path!==join(scenario,'value.mjs'));
      item.unexpectedActions=item.nativeEvidence?.observations.some(entry=>!['read','bash',...(scenario==='repair'?['write','edit']:[])].includes(entry.toolName)||(entry.toolName==='bash'&&entry.command!==command))??false;
      item.outcome=!item.deadlineExpired&&!item.unexpectedChanges&&!item.unexpectedActions&&item.observedExpectedExit&&item.testFileUnchanged&&state.operation?.kind==='completed'&&(scenario!=='compaction'||item.compactionObserved)?'completed-needs-review':'failed';
      item.explanationReview='Independent review of live Agent A final response and B claims remains required.';
    } catch(error) {item.outcome='failed';item.error=safeDisplayText(error instanceof Error?error.message:String(error)).slice(0,1600);}
    finally {clearTimeout(timer);await service.dispose();item.elapsedMs=performance.now()-started;item.cleanup='drained';await record();}
    console.log(JSON.stringify({scenario,outcome:item.outcome,elapsedMs:item.elapsedMs,observedExpectedExit:item.observedExpectedExit}));
    if(item.outcome==='failed'){process.exitCode=1;break;}
  }
}
