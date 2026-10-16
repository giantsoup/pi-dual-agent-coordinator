import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { visibleWidth } from '@mariozechner/pi-tui';

const here = dirname(fileURLToPath(import.meta.url));
function saveArtifact(filename, content) {
  const path=join(here,filename);
  if(process.argv[2]==='--check') {
    const actual=readFileSync(path,'utf8');
    if(filename==='layout-checks.json') {
      const previous=JSON.parse(actual),next=JSON.parse(content);
      delete previous.checkedAt; delete next.checkedAt;
      if(JSON.stringify(previous)!==JSON.stringify(next))throw new Error('Stale artifact: '+filename);
    } else if(actual!==content)throw new Error('Stale artifact: '+filename);
  } else writeFileSync(path,content);
}
function fit(value, width) {
  const chars = Array.from(String(value));
  return (chars.length > width ? chars.slice(0, width - 3).join('') + '...' : chars.join('')).padEnd(width);
}
function line(text, width, style = 'text') { return [{ text: fit(text, width), style }]; }
function currentContent(width, role) {
  const senior = role === 'A';
  const name = senior ? 'A - Senior' : 'B - Junior';
  if (width < 85) return [
    {text:'CURRENT TURN 13  |  Active: ' + name,style:'bar-'+role},
    {text:'Keep tool history visible and expandable',style:'title'},
    {text:senior?'Plan DONE  >  Execute DONE  >  REVIEW RUNNING':'Plan DONE  >  EXECUTE RUNNING  >  Review WAIT',style:'dim'},
    {text:senior?'>> STEP 3 OF 3 / REVIEWING THE HANDOFF':'>> STEP 2 OF 3 / RUNNING TESTS',style:'step-'+role},
    {text:senior?'A08 / checking B06 result / 4s':'B06 / bash npm test -- activity-history / 18s',style:'role-'+role},
    {text:senior?'No tool running. Senior is reviewing.':'RUNNING / no exit status yet',style:'text'},
    {text:senior?'B06 tools: 4 completed / tests passed':'B06 tools: 3 completed / 1 running',style:'dim'},
    {text:senior?'Latest evidence: PASS 8 focused checks':'Latest output: PASS retained-history fixture 03',style:'text'},
    {text:senior?'Next: Senior returns a final decision':'Next: Senior reviews the completed handoff',style:'dim'},
    {text:'Enter inspect call or run / Space fold',style:'dim'}
  ];
  return [
    {text:'CURRENT TURN 13  |  Active: ' + name,style:'bar-'+role},
    {text:'Keep tool history visible and expandable',style:'title'},
    {text:'',style:'text'},
    {text:'You: Keep current tools visible; let me inspect past tools and agent runs.',style:'text'},
    {text:'',style:'text'},
    {text:senior?'Plan [DONE]  ----  Execute [DONE]  ----  Review [RUNNING]':'Plan [DONE]  ----  Execute [RUNNING]  ----  Review [WAIT]',style:'dim'},
    {text:'',style:'text'},
    {text:senior?'>> STEP 3 OF 3 / REVIEWING THE HANDOFF':'>> STEP 2 OF 3 / RUNNING TESTS',style:'step-'+role},
    {text:senior?'A08 / Senior is reviewing the B06 handoff / 4s':'B06 / Junior is verifying the accepted plan / 24s',style:'role-'+role},
    {text:'',style:'text'},
    {text:senior?'CURRENT ACTIVITY / Review implementation and verification':'CURRENT TOOL / bash npm test -- activity-history',style:'title'},
    {text:senior?'Review in progress. No tool is currently running.':'RUNNING 18s / No exit status yet / Enter inspect',style:'role-'+role},
    {text:'',style:'text'},
    {text:'RECENT TOOLS / B06',style:'dim'},
    {text:'  B - Junior  [DONE] read src/types/ui.ts',style:'text'},
    {text:'  B - Junior  [DONE] read src/app/tui/app.ts',style:'text'},
    {text:'  B - Junior  [DONE] edit src/app/activity-history.ts',style:'text'},
    {text:senior?'  B - Junior  [DONE] bash npm test -- activity-history':'  B - Junior  [RUN]  bash npm test -- activity-history',style:'role-B'},
    {text:'',style:'text'},
    {text:senior?'Latest evidence: PASS 8 focused checks / exit 0':'Latest output: PASS retained-history fixture 03',style:'text'},
    {text:senior?'Next: Senior returns a final decision.':'Next: Senior reviews after Junior completes the handoff.',style:'dim'}
  ];
}
function history(width, compact = false, chronological = false) {
  const entries = [
    '> Turn 12 [DONE] Fix viewport anchor / 8 tools / 3 runs',
    '> Turn 11 [DONE] Preserve drafts / 6 tools / 3 runs',
    '> Turn 10 [DONE] Tighten cancellation / 4 tools / 2 runs'
  ];
  if (chronological) entries.reverse();
  return [
    line('PREVIOUS TURNS / 3 retained', width, 'history-label'),
    ...entries.map(text=>line(text,width,'history')),
    ...(!compact ? [line('  Enter opens retained tools and agent-run history', width, 'history')] : [])
  ];
}
function activePanel(width, height, role, framed = true) {
  const content = currentContent(width, role);
  const result = [];
  if (framed) result.push(line('+' + '-'.repeat(width - 2) + '+', width, 'edge-'+role));
  const available = height - (framed ? 2 : 0);
  for (let index = 0; index < available; index++) {
    const item = content[index] || {text:'',style:'text'};
    if (framed) result.push([
      {text:'| ',style:'edge-'+role},
      {text:fit(item.text,width-4),style:'stage-'+role+' '+item.style},
      {text:' |',style:'edge-'+role}
    ]);
    else result.push([{text:'| ',style:'edge-'+role},{text:fit(item.text,width-2),style:'stage-'+role+' '+item.style}]);
  }
  if (framed) result.push(line('+' + '-'.repeat(width - 2) + '+', width, 'edge-'+role));
  return result;
}
function makeLayout(option, columns, rows, role) {
  const name = role === 'A' ? 'A - Senior' : 'B - Junior';
  const narrow = columns === 80;
  const bodyHeight = rows - 9;
  let body;
  if (option === 'framed') {
    const past = narrow ? [line('PREVIOUS / Turn 10 DONE / Turn 11 DONE / Turn 12 DONE',columns,'history')] : history(columns,false,true);
    body = [...past, line('',columns), ...activePanel(columns,bodyHeight-past.length-1,role)];
  } else if (option === 'pinned') {
    const pastHeight = narrow ? 5 : 7;
    body = [...activePanel(columns,bodyHeight-pastHeight,role,false),line('-'.repeat(columns),columns,'rule')];
    const past = history(columns,true);
    for(let i=0;i<pastHeight-1;i++)body.push(past[i]||line('',columns));
  } else if (option === 'rail') {
    if (narrow) body = [line('HISTORY / 3 past turns / open with the History control',columns,'history-label'),...activePanel(columns,bodyHeight-1,role)];
    else {
      const railWidth=27, stageWidth=columns-railWidth-2;
      const past=[line('HISTORY / 3 turns',railWidth,'history-label'),line('',railWidth),
        line('> Turn 12 [DONE]',railWidth,'history'),line('  Fix viewport anchor',railWidth,'history'),line('  8 tools / 3 runs',railWidth,'history'),line('',railWidth),
        line('> Turn 11 [DONE]',railWidth,'history'),line('  Preserve drafts',railWidth,'history'),line('  6 tools / 3 runs',railWidth,'history'),line('',railWidth),
        line('> Turn 10 [DONE]',railWidth,'history'),line('  Tighten cancellation',railWidth,'history'),line('  4 tools / 2 runs',railWidth,'history'),line('',railWidth),
        line('Enter inspect past turn',railWidth,'history'),line('Current stays on the right',railWidth,'history')];
      const current=activePanel(stageWidth,bodyHeight,role);
      body=current.map((right,index)=>[...(past[index]||line('',railWidth)),{text:'  ',style:'text'},...right]);
    }
  } else throw new Error('Unknown layout');
  const activeLabel = 'Active: '+name;
  const inactiveLabel = role==='B'?'  |  A - Senior / waiting':'  |  B - Junior / complete';
  return [
    line('pi-dual  /fixture/project  |  '+(role==='B'?'EXECUTION':'REVIEW')+'  |  '+columns+' x '+rows,columns,'dim'),
    [{text:activeLabel,style:'bar-'+role},{text:inactiveLabel,style:'role-'+(role==='B'?'A':'B')},{text:' '.repeat(columns-activeLabel.length-inactiveLabel.length),style:'text'}],
    line('='.repeat(columns),columns,'rule'),
    ...body,
    line('-'.repeat(columns),columns,'rule'),
    line('Active: '+name+' / Turn 13 / '+(role==='B'?'Running tests / 18s':'Reviewing handoff / 4s'),columns,'role-'+role),
    line('DRAFT / preserved while inspecting history',columns,'dim'),
    line('> Also retain completed agent runs.',columns),
    line('F1 help | F6 panes | Enter inspect | Space fold | F2 activity',columns,'dim'),
    line('Esc back | End follow live | Ctrl+C cancel',columns,'dim')
  ];
}
function escapeHtml(value) { return value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;'); }

const checks=[];
for(const option of ['framed','pinned','rail'])for(const columns of [120,80])for(const role of ['A','B']){
  const rows=columns===120?40:24;
  const screen=makeLayout(option,columns,rows,role);
  if(screen.length!==rows)throw new Error('Incorrect row count');
  if(screen.some(row=>visibleWidth(row.map(part=>part.text).join(''))!==columns))throw new Error('Incorrect display width');
  if(!screen.some(row=>row.some(part=>part.text.includes('CURRENT TURN 13'))))throw new Error('Active turn missing');
  if(!screen.some(row=>row.some(part=>part.text.includes(role==='B'?'STEP 2 OF 3':'STEP 3 OF 3'))))throw new Error('Active step missing');
  if(!screen.some(row=>row.some(part=>part.text.includes('F1 help'))))throw new Error('Help hint missing');
  checks.push({option,columns,rows,role,passed:true});
}

const styles=`
:root{--a:#66d9ef;--b:#ffca70;--ink:#e4eaf2;--dim:#a7b3c6;--line:#455066;color-scheme:dark}*{box-sizing:border-box}body{margin:0;background:transparent;color:var(--foreground,#e4eaf2);font:15px/1.5 var(--font-sans,system-ui)}main{max-width:1160px;margin:auto}p{margin:8px 0 16px}h1{font-size:25px;line-height:1.25;margin:0 0 10px}h2{font-size:19px;margin:22px 0 8px}button,select{font:inherit;color:inherit;background:var(--secondary,#202a3a);border:1px solid var(--border,#455066);border-radius:6px;padding:7px 10px;cursor:pointer}button[aria-pressed=true]{background:#304256;border-color:#a7b3c6}button:focus-visible,select:focus-visible{outline:2px solid var(--a);outline-offset:2px}.toolbar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:12px 0}.muted{color:var(--muted-foreground,#a7b3c6)}.scroll{overflow:auto;padding:2px}.terminal{font:13px/18px 'SFMono-Regular',Consolas,'Liberation Mono',monospace;width:max-content;background:#10151e;color:#e4eaf2;padding:16px;border:1px solid #455066;border-radius:10px;outline:none}.row{height:18px;white-space:pre}.seg{display:inline-block;height:18px;line-height:18px;vertical-align:top;white-space:pre}.dim{color:#a7b3c6}.history{color:#96a3b8}.history-label{color:#b5c0d0;font-weight:bold}.rule{color:#455066}.role-A,.edge-A{color:var(--a)}.role-B,.edge-B{color:var(--b)}.stage-A,.edge-A{background:#15252d}.stage-B,.edge-B{background:#29251c}.bar-A{background:var(--a);color:#10151e;font-weight:bold}.bar-B{background:var(--b);color:#10151e;font-weight:bold}.title{font-weight:bold}.step-A{color:var(--a);font-weight:bold;text-decoration:underline}.step-B{color:var(--b);font-weight:bold;text-decoration:underline}.mono .terminal{filter:grayscale(1)}.copy{max-width:900px}.screenshots{display:grid;gap:20px}.screenshots.side{grid-template-columns:repeat(3,minmax(0,1fr))}.shot{min-width:0}.shot h2{margin-top:0}.shot img{display:block;width:100%;height:auto;border:1px solid var(--border,#455066);border-radius:var(--radius,8px)}.shot p{font-size:14px}.tag{font-size:12px;color:var(--muted-foreground,#a7b3c6)}a{color:var(--primary,#87ccff)}@media(max-width:700px){.screenshots.side{grid-template-columns:1fr}}
`;
if (process.argv[2] === '--screen') {
  const option=process.argv[3], columns=Number(process.argv[4]), role=process.argv[5];
  if(!['framed','pinned','rail'].includes(option)||![80,120].includes(columns)||!['A','B'].includes(role))throw new Error('Use --screen framed|pinned|rail 80|120 A|B');
  const screen=makeLayout(option,columns,columns===120?40:24,role);
  const markup=screen.map(row=>'<div class="row">'+row.map(part=>'<span class="seg '+part.style+'">'+escapeHtml(part.text)+'</span>').join('')+'</div>').join('');
  process.stdout.write('<!doctype html><html lang="en"><meta charset="utf-8"><title>Active turn '+option+'</title><style>'+styles+'</style><div class="terminal" style="width:calc('+columns+'ch + 34px)">'+markup+'</div></html>');
  process.exit(0);
}
const functions=[fit,line,currentContent,history,activePanel,makeLayout,escapeHtml].map(fn=>fn.toString()).join('\n');
const runtime=`
${functions}
let option='rail',columns=120,role='B',help=false,detail=false,helpReturnDetail=false;
function toggleHelp(){if(help){help=false;detail=helpReturnDetail;helpReturnDetail=false}else{helpReturnDetail=detail;help=true;detail=false}render()}
const captions={framed:'1 / Framed current turn. A border, tinted body and strong current-step label separate Turn 13 from the completed timeline. Best balance of context and emphasis.',pinned:'2 / Pinned current-work area. The active turn stays at the top; completed history occupies a separate lower region. Strongest at-a-glance monitoring.',rail:'3 / Current-turn workspace. A slim rail contains older turns, while the current turn gets most of the width. Best when you spend most of your time on the current task.'};
function render(){const rows=columns===120?40:24;let screen=makeLayout(option,columns,rows,role);if(help||detail){const content=help?['SHORTCUTS / F1 or Esc closes','','F1 or /help  Quick controls','F6 / Shift+F6  Cycle focused panes','Enter inspect / Space fold selected item','F2 activity / Esc return / End follow','Ctrl+C cancel / Tab editor completion','','Draft and active-agent identity stay visible.']:['HISTORY / Turn 12 / B05 / failed test call','','bash npm test -- tui-app','FAIL viewport anchor check','Expected: message 22 / Received: message 23','Exit code: 1','','The later verification passed. This failure is retained.','Esc returns to the current turn.'];for(let i=3;i<rows-6;i++)screen[i]=line(content[i-3]||'',columns,i===3?'history-label':'text')};document.querySelector('#terminal').innerHTML=screen.map(row=>'<div class="row">'+row.map(part=>'<span class="seg '+part.style+'">'+escapeHtml(part.text)+'</span>').join('')+'</div>').join('');document.querySelector('#terminal').style.width='calc('+columns+'ch + 34px)';document.querySelector('#caption').textContent=captions[option];document.querySelectorAll('[data-option]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.option===option)));document.querySelector('#size').value=columns;document.querySelector('#role').value=role;}
document.querySelectorAll('[data-option]').forEach(button=>button.onclick=()=>{option=button.dataset.option;help=false;detail=false;render()});document.querySelector('#size').onchange=event=>{columns=Number(event.target.value);render()};document.querySelector('#role').onchange=event=>{role=event.target.value;render()};document.querySelector('#help').onclick=toggleHelp;document.querySelector('#history').onclick=()=>{detail=!detail;help=false;helpReturnDetail=false;render()};document.querySelector('#mono').onclick=()=>document.body.classList.toggle('mono');document.addEventListener('keydown',event=>{if(event.key==='F1'){event.preventDefault();toggleHelp()}else if(event.key==='Escape'){event.preventDefault();if(help)toggleHelp();else{detail=false;render()}}});
window.activeTurnStudy={setState:state=>{({option,columns,role}={option,columns,role,...state});help=false;detail=false;helpReturnDetail=false;render()},getState:()=>({option,columns,role,help,detail}),getRows:()=>makeLayout(option,columns,columns===120?40:24,role)};render();
`;
const mockup=`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Active-turn layout study</title><style>${styles}</style><main><h1>Make the active turn the main event</h1><p class="muted">Three layout proposals using the same synthetic workflow. Browser mockups, not implemented terminal behavior.</p><div class="toolbar"><button data-option="framed" aria-pressed="false">1 / Framed turn</button><button data-option="pinned">2 / Pinned current work</button><button data-option="rail" aria-pressed="true">3 / History rail</button></div><div class="toolbar"><label>Size <select id="size"><option value="120">120 × 40</option><option value="80">80 × 24</option></select></label><label>Active role <select id="role"><option value="B">B - Junior</option><option value="A">A - Senior</option></select></label><button id="help">F1 shortcuts</button><button id="history">Inspect history</button><button id="mono">Monochrome</button></div><div class="scroll"><div id="terminal" class="terminal" tabindex="0" role="region" aria-label="Active-turn mockup"></div></div><p id="caption" class="copy"></p><p class="muted">F1 and Esc operate this mockup. The remaining footer keys describe the proposed TUI controls. No tools execute.</p></main><script>${runtime}</script></html>`;
saveArtifact('mockups.html',mockup+'\n');
const comparison=`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Choose the active-turn treatment</title><style>${styles}</style><main><p>All three give the current step a stronger title, more space and a clear boundary from history. The screenshots use identical workflow data. <strong>Selected direction: option 3, current workspace with history rail.</strong></p><div class="toolbar"><label>Terminal <select id="compare-size"><option value="120">120 × 40</option><option value="80">80 × 24</option></select></label><label>Active role <select id="compare-role"><option value="B">B - Junior</option><option value="A">A - Senior</option></select></label><button id="arrangement" aria-pressed="false">Side by side</button></div><p class="muted">Synthetic browser captures of proposed TUIs. Cyan identifies Senior; amber identifies Junior. The Active label, border and step marker also work without color.</p><div class="screenshots" id="gallery">
<article class="shot"><h2>1. Framed current turn</h2><p>Keep history in chronological order, then give the active turn its own tinted frame. Its current step gets a bold, underlined heading. This adds the clearest separation with the smallest change to the timeline.</p><a data-full="framed"><img data-shot="framed" alt="Option 1: compact previous turns above a bordered, tinted current turn with its running step emphasized"></a><p class="muted">Tradeoff: a little vertical space goes to the frame. While browsing far back, keep a compact live pointer and an explicit return-to-current action.</p></article>
<article class="shot"><h2>2. Pinned current-work area</h2><p>Put the active turn at the top and give it a fixed region. Previous turns live in a separate lower region. Current work remains the first thing you see while history updates.</p><a data-full="pinned"><img data-shot="pinned" alt="Option 2: a large pinned active-work region above a separate completed-history region"></a><p class="muted">Tradeoff: the screen no longer reads as one chronological transcript. Long outputs need scrolling inside the active region or an inspector.</p></article>
<article class="shot"><h2>3. Current workspace with history rail <span class="tag">Selected</span></h2><p>Move previous turns into a narrow navigation rail and devote the main workspace to the active turn. At 80 columns, the rail becomes a compact history control.</p><a data-full="rail"><img data-shot="rail" alt="Option 3: previous turns in a slim left rail beside a large current-turn workspace"></a><p class="muted">Tradeoff: reviewing older conversations takes more navigation, and the rail reduces the space available for long paths and commands.</p></article>
</div><p><strong>Common behavior:</strong> selecting an older record never changes the Active label or the working agent. Current and past tools and agent runs remain inspectable. F1 opens help; Esc returns with the draft and read position intact.</p><p class="muted">These images compare hierarchy, not terminal performance. Both supported terminal sizes and both active-role states were checked with the installed Pi display-width helper. Full implementation still needs the history storage and inspection work described in the original report.</p></main><script>function update(){const size=document.querySelector('#compare-size').value,role=document.querySelector('#compare-role').value;document.querySelectorAll('[data-shot]').forEach(image=>{image.src='screenshots/'+image.dataset.shot+'-'+role+'-'+size+'x'+(size==='120'?'40':'24')+'.png'});document.querySelectorAll('[data-full]').forEach(link=>{link.href='screenshots/'+link.dataset.full+'-'+role+'-'+size+'x'+(size==='120'?'40':'24')+'.png'})}document.querySelector('#compare-size').onchange=update;document.querySelector('#compare-role').onchange=update;document.querySelector('#arrangement').onclick=event=>{const active=document.querySelector('#gallery').classList.toggle('side');event.target.setAttribute('aria-pressed',String(active));event.target.textContent=active?'Stack vertically':'Side by side'};update();</script></html>`;
saveArtifact('comparison.html',comparison+'\n');
saveArtifact('layout-checks.json',JSON.stringify({checkedAt:new Date().toISOString(),screens:checks,checks:['exact terminal row count','Pi visibleWidth equals specified columns','current turn label visible','correct active step visible','F1 help hint visible'],limitations:'ASCII fixture; no real terminal interaction or provider execution.'},null,2)+'\n');
console.log((process.argv[2]==='--check'?'Checked':'Built')+' both HTML artifacts; validated 12 layouts with Pi display-cell widths.');
