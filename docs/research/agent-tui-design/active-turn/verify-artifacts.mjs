import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const here=dirname(fileURLToPath(import.meta.url));
const run=(args)=>{const result=spawnSync(process.execPath,args,{encoding:'utf8'});assert.equal(result.status,0,result.stderr||result.stdout);return result.stdout;};
run([join(here,'build.mjs'),'--check']);
run(['--check',join(here,'verify-browser.js')]);
const temp=mkdtempSync(join(tmpdir(),'pi-design-qa-'));
try {
  for(const file of ['mockups.html','comparison.html']) {
    const html=readFileSync(join(here,file),'utf8');
    let index=0;
    for(const match of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) {
      const path=join(temp,`${file}-${index++}.js`);writeFileSync(path,match[1]);run(['--check',path]);
    }
  }
  const mockup=readFileSync(join(here,'mockups.html'),'utf8');
  assert.ok(mockup.includes("let option='rail',columns=120"),'Selected layout must be the default');
  assert.ok(mockup.includes('function toggleHelp()'),'Help must retain the previous history view');
  const manifest=JSON.parse(readFileSync(join(here,'screenshots.json'),'utf8'));
  assert.equal(manifest.length,12);
  const seen=new Set();
  for(const entry of manifest) {
    assert.ok(!seen.has(entry.file),'Duplicate screenshot');seen.add(entry.file);
    const image=readFileSync(join(here,entry.file));
    assert.equal(image.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
    assert.equal(image.readUInt32BE(16),entry.width);assert.equal(image.readUInt32BE(20),entry.height);
    assert.equal(createHash('sha256').update(image).digest('hex'),entry.sha256);
  }
  for(const file of ['README.md','IMPLEMENTATION_PROMPT.md','QA_REPORT.md','../README.md']) {
    const path=resolve(here,file),text=readFileSync(path,'utf8');
    for(const match of text.matchAll(/\]\(([^)]+)\)/g)) {
      const target=match[1];if(/^(https?:|#)/.test(target))continue;
      readFileSync(resolve(dirname(path),decodeURIComponent(target.split('#')[0])));
    }
  }
  console.log('PASS: selected default, generated artifacts, inline JavaScript, 12 PNG hashes/dimensions and local documentation links.');
} finally {rmSync(temp,{recursive:true,force:true});}
