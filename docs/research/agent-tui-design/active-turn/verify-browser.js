// Run on mockups.html or comparison.html:
// await (0, eval)(await (await fetch('verify-browser.js')).text())
(async()=>{
  const check=(condition,message)=>{if(!condition)throw new Error(message);};
  if(window.activeTurnStudy){
    const api=window.activeTurnStudy,results=[];
    for(const option of ['framed','pinned','rail'])for(const columns of [120,80])for(const role of ['A','B']){
      api.setState({option,columns,role});
      const rows=columns===120?40:24,screen=api.getRows();
      check(screen.length===rows&&document.querySelectorAll('#terminal>.row').length===rows,'Row count');
      check(screen.every(row=>Array.from(row.map(part=>part.text).join('')).length===columns),'ASCII fixture width');
      const before=document.querySelector('#terminal').textContent;
      document.querySelector('#history').click();
      document.dispatchEvent(new KeyboardEvent('keydown',{key:'F1',bubbles:true,cancelable:true}));
      check(api.getState().help&&!api.getState().detail,'Help opens above history');
      document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
      check(api.getState().detail&&!api.getState().help,'Esc restores history below help');
      document.querySelector('#help').click();document.querySelector('#help').click();
      check(api.getState().detail&&!api.getState().help,'F1 button also restores history');
      check(document.querySelector('#terminal').textContent.includes('Active: '+role+' - '+(role==='A'?'Senior':'Junior')),'Active role preserved');
      document.querySelector('#history').click();
      check(document.querySelector('#terminal').textContent===before,'Workspace restored unchanged');
      results.push({option,columns,role});
    }
    api.setState({option:'rail',columns:120,role:'B'});
    return {layouts:results.length,helpHistoryRestoration:results.length,selectedDefault:'rail',limits:'Static drafts and records; no real submission, focus cycle or durable history implementation.'};
  }
  const results=[];
  for(const size of ['120','80'])for(const role of ['B','A']){
    const sizeInput=document.querySelector('#compare-size'),roleInput=document.querySelector('#compare-role');
    sizeInput.value=size;sizeInput.dispatchEvent(new Event('change'));
    roleInput.value=role;roleInput.dispatchEvent(new Event('change'));
    await Promise.all([...document.images].map(image=>image.decode()));
    check([...document.images].every(image=>image.naturalWidth&&image.src.includes('-'+role+'-'+size+'x')),'Correct comparison images load');
    results.push({size,role,images:document.images.length});
  }
  document.querySelector('#arrangement').click();check(document.querySelector('#gallery').classList.contains('side'),'Side-by-side mode');
  document.querySelector('#arrangement').click();check(!document.querySelector('#gallery').classList.contains('side'),'Stacked mode');
  return {combinations:results.length,images:results.reduce((total,item)=>total+item.images,0),arrangementPassed:true};
})()
