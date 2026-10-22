// B-only controlled comparison. No operator workflow approval or runtime activation occurs here.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cp, mkdir, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { assertions } from './verify-agent-b-expectations.mjs';
const source = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const option = key => args[args.indexOf(key) + 1];
const live = args.includes('--live');
const runtime = args.includes('--runtime-root') ? resolve(option('--runtime-root')) : source;
const baseline = args.includes('--baseline-root') ? resolve(option('--baseline-root')) : runtime;
assert(args.includes('--output'), 'Supply --output with a new directory outside the workspace');
const output = resolve(option('--output'));
assert(!output.startsWith(source + '/'), 'Reports belong outside the writable checkout');
await mkdir(output, { recursive: false, mode: 0o700 });
const hash = value => createHash('sha256').update(value).digest('hex');
const load = (root, name) => import(pathToFileURL(join(root, name)).href);
const files = ['book-list.mjs', 'book-list.test.mjs', 'passing.test.mjs'];
const fixtureRoot = join(source, 'test/fixtures/agent-b-reliability');
const inputHashes = Object.fromEntries(await Promise.all(files.map(async name => [name, hash(await readFile(join(fixtureRoot, name)))])));
const ids = { workflowId: 'benchmark-workflow', handoffId: 'current-verification', iteration: 2 };
const tasks = ['pass', 'fail', 'fail', 'pass', 'fail'];
const command = task => `node --test --test-reporter=tap ${task === 'pass' ? 'passing' : 'book-list'}.test.mjs`;
const totals = task => task === 'pass' ? { tests: 1, pass: 1, fail: 0 } : { tests: 30, pass: 28, fail: 2 };
const expectedDifferences = assertions.filter(item => item.reached && !item.correct).map(({ test, direction, actual, expected }) => ({ test, direction, actual, expected }));
const fact = task => ({ command: command(task), exitCode: task === 'pass' ? 0 : 1, totals: totals(task), assertionDifferences: task === 'pass' ? [] : expectedDifferences });
const envelope = task => ({ schemaVersion: 1, ...ids, objective: 'Record the observed verification result without repair.',
  summary: 'Verify the copied benchmark. Historical seed results do not verify this handoff.', relevantPaths: [task === 'pass' ? 'passing.test.mjs' : 'book-list.test.mjs'],
  acceptanceCriteria: ['Report the native command, exit code, totals, and observed assertion differences, including failures. No repair is requested.'],
  executionPlan: [`Read ${task === 'pass' ? 'passing' : 'book-list'}.test.mjs once. Run ${command(task)} once.`,
    'After the command returns, emit pi-completion and stop, including on failure.'],
  constraints: ['Do not inspect other files, rerun checks, diagnose causes, or repair. Use changedPaths: []. Leave causes unresolved.'] });
const reportInstruction = 'For this benchmark only, put one JSON string in verification encoding {command,exitCode,totals:{tests,pass,fail},assertionDifferences:[{test,direction,actual,expected}]}. Describe only assertions actually observed before each test case stopped. Leave causal diagnosis unresolved in openQuestions. Do not infer hidden assertions.';
const completionText = task => '```pi-completion\n' + JSON.stringify({ schemaVersion: 1, ...ids, summary: task === 'pass' ? 'Check passed.' : 'Check failed; application correctness is unresolved.', changedPaths: [], verification: [JSON.stringify(fact(task))], openQuestions: ['Causes unresolved.'] }) + '\n```';

export function classifyTrial(record, expected) {
  const starts = record.calls;
  const correlated = starts.length === record.results.length && starts.every(call => record.results.filter(result => result.id === call.id && result.name === call.name).length === 1);
  const check = record.results.find(result => result.name === 'bash');
  const exactActions = JSON.stringify(starts.map(call => call.name)) === JSON.stringify(['read', 'bash']) && starts[0]?.path === expected.path && starts[1]?.command === expected.fact.command;
  let reported;
  try { reported = JSON.parse(record.completion?.verification?.[0]); } catch { /* Missing facts remain unknown. */ }
  const nativeTotals = check?.structured?.output;
  const observed = correlated && check?.structured?.exit_code === expected.fact.exitCode && check.structured.truncated === false
    && Object.entries(expected.fact.totals).every(([key, value]) => new RegExp(`^# ${key} ${value}$`, 'm').test(nativeTotals ?? ''));
  const reportAccurate = Boolean(observed && isDeepStrictEqual(reported, expected.fact)
    && reported.command === starts.find(call => call.name === 'bash')?.command
    && reported.exitCode === check?.structured?.exit_code);
  const completed = !record.timedOut && record.validCompletion && exactActions && observed && record.unchanged && record.cleanup === 'drained';
  return { correlated, exactActions, observed, reportAccurate, completed,
    category: record.timedOut ? (record.calls.length ? 'probe_deadline_after_native_progress' : record.partialProgress ? 'probe_deadline_during_generation' : 'probe_deadline_no_observed_progress')
      : record.unknownOutcome ? 'unknown_native_outcome' : record.printedMarkup ? 'settled_printed_markup' : !correlated ? 'uncorrelated_results' : !observed ? 'missing_native_facts' : !reportAccurate ? 'incorrect_report' : completed ? 'completed' : 'incomplete',
    accepted: Boolean(completed && reportAccurate) };
}
// Self-check the classifier against misleading reports and absent/unknown execution.
const good = { calls: [{ id:'r', name:'read', path:'book-list.test.mjs' }, { id:'b', name:'bash', command:command('fail') }],
  results: [{ id:'r', name:'read' }, { id:'b', name:'bash', isError:true, structured:{exit_code:1, truncated:false, output:'# tests 30\n# pass 28\n# fail 2'} }],
  validCompletion:true, completion:{verification:[JSON.stringify(fact('fail'))]}, unchanged:true, cleanup:'drained' };
const expected = { path:'book-list.test.mjs', fact:fact('fail') };
assert.equal(classifyTrial(good, expected).accepted, true, 'A failed check is observed execution');
for (const bad of [ { ...good, results:[] }, { ...good, timedOut:true }, { ...good, calls:[] }, { ...good, results:[good.results[0], {...good.results[1], structured:{exit_code:1, truncated:true, output:"# tests 30"}}] },
  { ...good, completion:{verification:[JSON.stringify({...fact('fail'), exitCode:0})]} },
  { ...good, completion:{verification:[JSON.stringify({...fact('fail'), assertionDifferences:expectedDifferences.map(d => ({...d,direction:'desc'}))})]} },
  { ...good, results:[good.results[0], {...good.results[1], structured:{...good.results[1].structured, exit_code:0}}] } ]) assert.equal(classifyTrial(bad, expected).accepted, false);

const wrapped = { ...good,
  calls:[{id:'r',name:'read',path:'passing.test.mjs'},{id:'b',name:'bash',command:command('pass')+'; echo "EXIT_CODE=$?"'}],
  results:[good.results[0],{id:'b',name:'bash',isError:false,structured:{exit_code:0,truncated:false,output:'# tests 1\n# pass 1\n# fail 0'}}],
  completion:{verification:[JSON.stringify(fact('pass'))]} };
assert.equal(classifyTrial(wrapped,{path:'passing.test.mjs',fact:fact('pass')}).reportAccurate,false,'Reports must match the observed command, including suffixes');
if (args.includes('--self-test')) { console.log(JSON.stringify({ outcome:'passed', classifierCases:9, assertionAudit:5 })); process.exit(0); }

if (live) {
  assert.notEqual(baseline, runtime, 'Live baseline and candidate require separate pinned snapshots');
  for (const root of [baseline, runtime]) execFileSync(join(root, 'bin/node'), [join(root, 'scripts/verify-installation.mjs')], { cwd:root, stdio:'pipe' });
}
let selected;
let thinking = 'off';
if (live) {
  const config = await load(runtime, 'dist/src/app/coordinator-config.js');
  const loaded = await config.loadCoordinatorConfig(); assert.equal(loaded.warnings.length, 0);
  const id = config.resolveEffectiveModelB({}, loaded.config).value;
  thinking = config.resolveEffectiveThinkingB({}, loaded.config).value;
  const { LmStudioModels } = await load(runtime, 'dist/src/security/lm-studio.js');
  selected = (await new LmStudioModels().listModels()).find(item => id === item.model.id || id === `lm-studio/${item.model.id}`);
  assert(selected?.loaded && !selected.disabledReason, 'Saved executor must already be loaded; no load or download is permitted');
}
const runtimeHashes = {};
for (const root of new Set([baseline, runtime])) runtimeHashes[root === runtime ? 'candidate' : 'baseline'] = Object.fromEntries(await Promise.all([
  'dist/src/runtime/create-role-runtime.js', 'dist/src/coordinator/execution-supervisor.js', 'dist/src/handoff/render-handoff-message.js', 'package-lock.json'
].map(async path => [path, hash(await readFile(join(root, path)))])));
if(live) for(const [arm,root] of [['baseline',baseline],['candidate',runtime]]) runtimeHashes[arm].installationManifestSha256=hash(await readFile(join(root,'installation-manifest.json')));
const design = { mode:live ? 'live-B-only' : 'fixture-B-only', model:selected?.model.id ?? 'fixture-local', thinking, inputHashes, runtimeHashes,
  deadlineMs:90000, modelTurnCap:7, tasks, contextVariants:['summary-only','native-tail'], expectedDifferences,
  retention:'Experimental in-memory projections only. Production policy is unchanged.', reportInstruction };
await writeFile(join(output,'design.json'), JSON.stringify(design,null,2));
const records = [];
const originalCwd = process.cwd();
let unsafe = false;
let sharedSeed;
const schedule = [];
for (let pair=0; pair<5; pair++) for (const variant of pair%2 ? ['native-tail','summary-only'] : ['summary-only','native-tail'])
  for (const arm of pair%2 ? ['candidate','baseline'] : ['baseline','candidate']) schedule.push({ pair, variant, arm, diagnostic:false });
let extended = 0;
for (const cell of schedule) {
    if (unsafe) break;
    const { pair, variant, arm, diagnostic } = cell;
    const deadlineMs = diagnostic ? 150000 : 90000;
    const name = `${pair+1}-${variant}-${arm}${diagnostic ? "-diagnostic-150s" : ""}`;
    const root = arm === 'candidate' ? runtime : baseline;
    const { SessionManager, buildSessionProjection } = await load(root,'node_modules/@earendil-works/pi-coding-agent/dist/index.js');
    const { createRoleRuntime } = await load(root,'dist/src/runtime/create-role-runtime.js');
    const { fixtureChatResponse, fixtureChatToolResponse } = await load(root,'dist/src/security/fixture-provider.js');
    const { createExecutionSupervisor } = await load(root,'dist/src/coordinator/execution-supervisor.js');
    const { renderHandoffMessage } = await load(root,'dist/src/handoff/render-handoff-message.js');
    const { resolveAgentBResponse } = await load(root,'dist/src/coordinator/review-cycle.js');
    const cwd=join(output,name); await mkdir(cwd);
    for (const file of files) await cp(join(fixtureRoot,file),join(cwd,file));
    const record={name, arm, variant, diagnostic, deadlineMs, pair:pair+1, task:tasks[pair], calls:[], results:[], recovery:[], diagnostics:[], partialProgress:false, printedMarkup:0, mutations:0};
    records.push(record); await writeFile(join(output,'results.json'),JSON.stringify(records,null,2));
    let manager;
    if (sharedSeed) {
      manager=SessionManager.inMemory(cwd,{},[{...sharedSeed.header,cwd,id:randomUUID()},...structuredClone(sharedSeed.entries)]);
    } else {
    manager=SessionManager.inMemory(cwd);
    let seedRequests=0;
    const seed=await createRoleRuntime({role:'B', cwd, agentDir:join(output,'empty-agent'),sessionRoot:join(output,'state'), sessionMode:'memory',initialSessionManager:manager, loadProjectResources:false,
      providerTestBackend:{cwd,modelIds:[],load:async()=>{throw Error('B cloud auth forbidden');}, request:async()=> ++seedRequests===1 ? fixtureChatToolResponse('read',{path:'passing.test.mjs'},'seed-read') : seedRequests===2 ? fixtureChatToolResponse('bash',{command:command('pass')},'seed-check') : fixtureChatResponse('Earlier check completed. New handoffs require fresh evidence.')} });
    const seedResults=[];
    seed.session.subscribe(event=>{if(event.type==='tool_execution_end')seedResults.push({name:event.toolName,id:event.toolCallId,isError:event.isError});});
    try { await seed.session.prompt('Read passing.test.mjs, run its test once, and stop.'); }
    finally { await seed.dispose(); process.chdir(originalCwd); }
    assert.deepEqual(seedResults.map(result=>[result.name,result.isError]),[['read',false],['bash',false]]);
    sharedSeed={header:manager.getHeader(),entries:structuredClone(manager.getEntries()),results:seedResults};
    sharedSeed.sha256=hash(JSON.stringify(sharedSeed.entries));
    await writeFile(join(output,'seed-evidence.json'),JSON.stringify({sha256:sharedSeed.sha256,results:seedResults,source:'Real fixture tool calls, historical only'},null,2));
    }
    record.historicalSeedResults=sharedSeed.results;
    record.seedHistorySha256=sharedSeed.sha256;
    const entries=manager.getEntries();
    const firstCall=entries.find(entry=>entry.type==='message' && entry.message.role==='assistant' && entry.message.content.some(part=>part.type==='toolCall'));
    assert(firstCall);
    const boundary=manager.appendCustomEntry('benchmark-boundary',{});
    manager.appendCompaction('Historical seed: a passing read and check completed in an earlier handoff. Current results are unknown. Leave causes unresolved.',variant==='native-tail' ? firstCall.id : boundary,1000);
    const projection=buildSessionProjection(manager.getEntries()).messages;
    record.historicalSeedCalls=projection.flatMap(m=>Array.isArray(m.content)?m.content:[]).filter(part=>part.type==='toolCall').length;
    assert.equal(record.historicalSeedCalls,variant==='native-tail'?2:0);
    // Copy the session in memory; no original archive is read or rewritten.
    const copied=SessionManager.inMemory(cwd,{},[manager.getHeader(),...manager.getEntries()]);
    let binding, timer; let requests=0, turns=0; const started=performance.now(); record.startedAt=new Date().toISOString();
    const task=tasks[pair];
    const prompt=renderHandoffMessage(envelope(task))+'\n'+reportInstruction;
    record.prompt=prompt; record.promptSha256=hash(prompt);
    try {
      binding=await createRoleRuntime({role:'B',cwd,agentDir:join(output,'empty-agent'),sessionRoot:join(output,'state'),sessionMode:'memory',initialSessionManager:copied,loadProjectResources:false,
        ...(live ? {modelOverride:`lm-studio/${selected.model.id}`,localModel:selected.model,thinkingOverride:thinking} : {providerTestBackend:{cwd,modelIds:[],load:async()=>{throw Error('B cloud auth forbidden');},request:async()=> ++requests===1 ? fixtureChatToolResponse('read',{path:task==='pass'?'passing.test.mjs':'book-list.test.mjs'},'current-read') : requests===2 ? fixtureChatToolResponse('bash',{command:command(task)},'current-check') : fixtureChatResponse(completionText(task))}}),
        onMutation:()=>{record.mutations++;},onProviderDiagnostic:event=>record.diagnostics.push({...event,benchmarkMs:performance.now()-started,requestBudget:binding?.session.requestBudget})});
      record.sessionId=binding.sessionId; record.diagnosticsAvailable=typeof binding.subscribeProviderDiagnostics==='function';
      record.activeTools=binding.session.piSession.getActiveToolNames().sort();
      binding.session.subscribe(event=>{
        if(event.type==='message_update') record.partialProgress=true;
        if(event.type==='tool_execution_start') record.calls.push({id:event.toolCallId,name:event.toolName,...(event.toolName==='bash'?{command:event.args.command}:event.toolName==='read'?{path:event.args.path}:{})});
        if(event.type==='tool_execution_end') { record.firstNativeResultMs ??= performance.now()-started; record.results.push({id:event.toolCallId,name:event.toolName,isError:event.isError,structured:event.result.structuredContent}); }
      });
      const supervisor=createExecutionSupervisor({bindingA:{},cwd,bridge:{assertActive(){}},envelope:envelope(task),setUiState(){},logEvent:(type,details)=>{if(type==='workflow.tool_recovery_redirected')record.recovery.push(details);}});
      timer=setTimeout(()=>{record.timedOut=true;record.cancelStartedMs=performance.now()-started;void binding.session.abort().then(()=>{record.cancelCompletedMs=performance.now()-started;},()=>{record.cancelCleanup="failed";});},deadlineMs);
      await binding.session.prompt(prompt,{onTurnEnd:async(event,signal)=>{
        if(++turns>7) throw Error('Benchmark model-turn cap');
        const text=event.message.content.filter(part=>part.type==='text').map(part=>part.text).join('\n');
        record.lastSettledResponse=text.slice(0,16000); // Text only. Never archive private thinking.
        if (/<tool_call\b|\[(?:END_)?TOOL_(?:CALL|REQUEST)\]/i.test(text))record.printedMarkup++;
        return supervisor(event,signal);
      }});
      const last=binding.session.messages.at(-1);
      const parsed=last && resolveAgentBResponse({message:last,...ids});
      record.validCompletion=parsed?.kind==='completion';
      if(record.validCompletion)record.completion=parsed.completion;
    } catch(error) { record.errorCategory=record.timedOut?'probe_deadline':error?.constructor?.name??'unknown'; record.unknownOutcome=/unknown.*result|result.*unknown/i.test(String(error)); }
    finally {
      clearTimeout(timer);
      try { await binding?.dispose();record.cleanup='drained'; } catch {record.cleanup='failed';}
      process.chdir(originalCwd);record.elapsedMs=performance.now()-started;
      record.unchanged=(await Promise.all(files.map(async file=>hash(await readFile(join(cwd,file)))===inputHashes[file]))).every(Boolean) && (await readdir(cwd)).sort().join(',')===files.slice().sort().join(',');
      record.requestBudget=binding?.session.requestBudget;
      record.settledAt=new Date().toISOString();
      record.unknownOutcome ||= record.calls.some(call=>!record.results.some(result=>result.id===call.id&&result.name===call.name));
      record.classification=classifyTrial(record,{path:task==='pass'?'passing.test.mjs':'book-list.test.mjs',fact:fact(task)});
      record.diagnosisReview='Causal explanations require independent read-only review; structured totals do not prove diagnosis.';
      unsafe=record.mutations>0 || !record.unchanged || record.unknownOutcome || record.cleanup!=='drained' || record.calls.some(call=>!['read','bash'].includes(call.name)) || record.calls.filter(call=>call.name==='read').length>1 || record.calls.filter(call=>call.name==='bash').length>1 || record.calls.filter(call=>call.name==='bash').some(call=>call.command!==command(task));
      record.stopBatch=unsafe;
      await writeFile(join(output,`${name}.json`),JSON.stringify(record,null,2));
      await writeFile(join(output,'results.json'),JSON.stringify(records,null,2));
      console.log(JSON.stringify({name,classification:record.classification,elapsedMs:record.elapsedMs}));
      // Keep unexpected workspace changes available for inspection; never replay an unknown outcome.
      if(!unsafe) await rm(cwd,{recursive:true,force:true});
      if(live && !diagnostic && !unsafe && record.timedOut && record.partialProgress && extended<2) {
        extended++; schedule.push({pair, variant, arm, diagnostic:true});
      }
    }
}
const primary=records.filter(record=>!record.diagnostic);
const candidates=primary.filter(record=>record.arm==='candidate');
const accepted=candidates.filter(record=>record.classification.accepted);
const summary={mode:design.mode,trials:primary.length,diagnosticTrials:records.length-primary.length,candidateAccepted:accepted.length,perContext:Object.fromEntries(['summary-only','native-tail'].map(variant=>[variant,accepted.filter(record=>record.variant===variant).length])),
  targetsMet:primary.length===20 && !unsafe && accepted.length>=9 && ['summary-only','native-tail'].every(variant=>accepted.filter(record=>record.variant===variant).length>=4),
  qualified:false, activation:false, retentionDecision:'unchanged pending controlled evidence and full workflow qualification',
  remaining:['Independent review of model explanations','Full Agent A/operator-approved workflow scenarios'], unsafe};
await writeFile(join(output,'summary.json'),JSON.stringify(summary,null,2));
console.log(JSON.stringify(summary));
if(!summary.targetsMet)process.exitCode=1;
