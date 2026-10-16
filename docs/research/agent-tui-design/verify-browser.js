// Run in the prototype page's browser console:
// await (0, eval)(await (await fetch('verify-browser.js')).text())
(async () => {
  const checks = [];
  const check = (condition, label) => { if (!condition) throw new Error(label); checks.push(label); };
  const api = window.designStudy;
  const terminal = document.querySelector('#terminal');
  const key = name => terminal.dispatchEvent(new KeyboardEvent('keydown', {key:name,bubbles:true,cancelable:true}));
  const text = () => terminal.innerText;
  api.setActive('B');
  api.setConcept('timeline');
  api.setSize(120);
  api.setExpanded(['T12','B05','T13','B06']);
  api.select('test12');
  api.inspect();
  api.showTab(1);
  check(text().includes('Exit code: 1'), 'Historical failed tool output is available');
  check(text().includes('Active: B - Junior'), 'Junior active label remains visible during historical inspection');
  const editor = document.querySelector('#draft');
  editor.value = 'Keep my draft';
  editor.dispatchEvent(new Event('input',{bubbles:true}));
  key('Escape');
  key(' ');
  check(api.getState().expanded.includes('T13'), 'One tool fold leaves another turn expanded');
  key('Enter');
  key('3');
  check(text().includes('npm test -- tui-app'), 'Inspector request tab keeps the original command');
  key('Escape');
  key('Escape');
  check(document.querySelector('#draft').value === 'Keep my draft', 'Draft survives folds and inspector close');
  check(document.activeElement.id === 'draft', 'Escape returns focus to the editor');
  const beforeHelp = api.getState();
  key('F1');
  check(api.getState().helpOpen && text().includes('SHORTCUTS / F1 or Esc'), 'F1 opens quick shortcut reference');
  check(text().includes('EDITOR') && text().includes('HISTORY') && text().includes('INSPECTOR'), 'Help groups controls by focus');
  check(text().includes('Active: B - Junior'), 'Help preserves active agent visibility');
  key('Escape');
  check(!api.getState().helpOpen && api.getState().focus === beforeHelp.focus && api.getState().selected === beforeHelp.selected, 'Closing help restores previous focus and selection');
  check(document.querySelector('#draft').value === 'Keep my draft', 'Help preserves the draft');
  key('F6');
  key('ArrowDown');
  check(api.getState().focus === 'timeline', 'F6 and arrows navigate history');
  api.select('B05');api.inspect();api.showTab(0);
  check(text().includes('Transcript excerpt') && text().includes('retained calls'), 'Completed agent run exposes transcript and retained tools');
  api.select('T12');api.inspect();
  check(text().includes('A05') && text().includes('A06'), 'Past turn exposes its constituent runs');
  api.select('test13');api.inspect();api.showTab(1);
  key('PageDown');
  check(text().includes('fixture 29'), 'Long current output pages in the inspector');
  check(text().includes('Active: B - Junior'), 'Long output leaves the live strip visible');
  api.setSize(80);api.select('test12');api.inspect();api.showTab(1);
  check(text().includes('Exit code: 1'), '80-column detail exposes historical output');
  check(text().includes('Active: B - Junior') && document.querySelector('#draft').value === 'Keep my draft', 'Narrow detail retains active agent and draft');
  key('F1');
  check(text().includes('Draft, selection and expanded rows survive this popup.'), 'Quick reference fits within the 80 by 24 body');
  key('F1');
  check(!api.getState().helpOpen, 'F1 also dismisses quick help');
  api.setActive('A');
  check(text().includes('Active: A - Senior'), 'Senior active label replaces Junior active label');
  check(!text().includes('Active: B - Junior'), 'Only the current role is labelled active');
  api.setSize(120);key('Escape');
  check(text().includes('B06 [DONE]') && text().includes('A08 [RUN]'), 'Senior handoff marks Junior complete and Senior review running');
  for (const concept of ['timeline','inline','agents']) {
    api.setConcept(concept);
    for (const width of [80,120]) {
      api.setSize(width);
      const rows = [...terminal.querySelectorAll(':scope > .line')];
      check(rows.length === (width===80?24:40), `${concept} has exact row count at ${width} columns`);
      check(rows.every(row=>Array.from(row.textContent).length<=width), `${concept} stays within ${width} columns`);
    }
  }
  const contrast = (hex1,hex2) => {
    const luminance = hex => {const values=hex.match(/[a-f\d]{2}/gi).map(channel=>parseInt(channel,16)/255).map(channel=>channel<=0.04045?channel/12.92:((channel+0.055)/1.055)**2.4);return values[0]*0.2126+values[1]*0.7152+values[2]*0.0722;};
    const a=luminance(hex1), b=luminance(hex2);return (Math.max(a,b)+0.05)/(Math.min(a,b)+0.05);
  };
  check(contrast('66d9ef','10151e')>=4.5, 'Senior foreground has at least 4.5:1 contrast in prototype dark palette');
  check(contrast('ffca70','10151e')>=4.5, 'Junior foreground has at least 4.5:1 contrast in prototype dark palette');
  check([...document.images].every(image=>image.complete&&image.naturalWidth>0), 'All three official visual references load');
  const baseline = await (await fetch('baseline.json')).json();
  check(baseline.captures.length===4&&baseline.captures.every(capture=>capture.text.split('\n').length===capture.rows), 'Four actual-renderer fixture captures have exact row counts');
  api.setActive('B');api.setConcept('timeline');api.setSize(120);api.setExpanded(['T12','B05','T13','B06']);api.select('test12');api.inspect();api.showTab(1);
  return {passed:checks.length, checks, limitations:'Synthetic browser prototype. No live provider run, terminal performance benchmark, or shipped expansion implementation.'};
})()
