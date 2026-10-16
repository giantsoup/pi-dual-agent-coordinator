#!/usr/bin/env python3
"""Drive real Pi runtimes and both terminal interfaces in isolated PTYs. No API key."""
import codecs
import hashlib
import fcntl
import json
import os
from pathlib import Path
import pty
import select
import signal
import struct
import subprocess
import tempfile
import termios
import time

REPO = Path(__file__).resolve().parents[1]
checks = 0
EVIDENCE = Path(os.environ.get('PI_TUI_EVIDENCE_DIR', REPO / 'test-results' / 'terminal-evidence'))
EVIDENCE.mkdir(parents=True, exist_ok=True)
CAPTURE = os.environ.get('PI_TUI_SCREEN_CAPTURE') == '1'
if CAPTURE:
    import pyte
    from wcwidth import wcswidth

# Ghostty 1.3.1 `+show-config --default`. Pyte names ANSI yellow "brown".
DEFAULT_PALETTE = {'default': 'ffffff', 'cyan': '8abeb7', 'brown': 'f0c674'}
DEFAULT_BACKGROUND = '282c34'


def luminance(rgb):
    channels = [int(rgb[i:i+2], 16) / 255 for i in (0, 2, 4)]
    linear = [value / 12.92 if value <= .04045 else ((value + .055) / 1.055) ** 2.4 for value in channels]
    return sum(value * weight for value, weight in zip(linear, [.2126, .7152, .0722]))


def contrast(foreground, background):
    light, dark = sorted([luminance(foreground), luminance(background)], reverse=True)
    return (light + .05) / (dark + .05)


def check(condition, message):
    global checks
    if not condition:
        raise AssertionError(message)
    checks += 1

class Terminal:
    def __init__(self, root, mode, size=(80,24), startup_failure=False):
        self.workspace = root / (mode + '-workspace'); self.workspace.mkdir()
        self.state_root = root / (mode + '-state'); self.state_root.mkdir()
        self.mode = mode
        self.decoder = codecs.getincrementaldecoder('utf-8')('replace')
        self.screen = pyte.Screen(size[0],size[1]) if CAPTURE else None
        self.stream = pyte.Stream(self.screen) if CAPTURE else None
        self.master, self.slave = pty.openpty()
        self.before = termios.tcgetattr(self.slave)
        self.size(*size)
        env = {**os.environ, 'PI_DUAL_COORDINATOR_HOME':str(root/'config'), 'TERM':'xterm-256color'}
        env.pop('NO_COLOR',None)
        self.process = subprocess.Popen(['node',str(REPO/'test/fixtures/terminal-app.mjs'),str(self.workspace),str(self.state_root),mode],stdin=self.slave,stdout=self.slave,stderr=self.slave,env=env)
        self.output = b''
        if startup_failure: self.wait(lambda:self.process.poll() is not None,'startup failure')
        else: self.wait(lambda: b'Enter submit' in self.output, 'startup')
    def read(self):
        while select.select([self.master],[],[],.01)[0]:
            try:
                chunk = os.read(self.master,65536)
                self.output += chunk
                if self.stream: self.stream.feed(self.decoder.decode(chunk))
            except OSError: break
    def wait(self, predicate, label, seconds=12):
        deadline = time.monotonic()+seconds
        while time.monotonic()<deadline:
            self.read()
            if predicate(): return
            if self.process.poll() is not None: break
            time.sleep(.02)
        raise AssertionError(label + ' timed out; exit=' + str(self.process.poll()) + '; tail=' + repr(self.output[-3000:]))
    def state(self):
        try: return json.loads((self.state_root/'ui-state.json').read_text())
        except (FileNotFoundError,json.JSONDecodeError): return {}
    def send(self, text): os.write(self.master,text.encode())
    def command(self,text): self.send(text+'\r')
    def size(self,cols,rows):
        if self.screen: self.screen.resize(lines=rows,columns=cols)
        fcntl.ioctl(self.slave,termios.TIOCSWINSZ,struct.pack('HHHH',rows,cols,0,0))
        if hasattr(self,'process'): self.process.send_signal(signal.SIGWINCH)
    def snapshot(self,label,role=None):
        time.sleep(.08);self.read()
        if self.screen:
            rows = self.screen.display
            check(len(rows)==self.screen.lines,'captured screen row budget')
            check(all(wcswidth(row)<=self.screen.columns for row in rows),'captured screen display-cell budget')
            check(any('F1 help' in row for row in rows),'help remains visible in captured screen')
            (EVIDENCE/(label+'.screen.txt')).write_text('\n'.join(rows)+'\n')
            cells = [self.screen.buffer[y][x] for y in range(self.screen.lines) for x in range(self.screen.columns)]
            text_cells = [cell for cell in cells if cell.data.strip()]
            check(all(cell.bg == 'default' for cell in cells),'no colored body fill: '+label+' '+repr({cell.bg for cell in cells}))
            check(all(not cell.reverse for cell in text_cells),'no inverse body text: '+label)
            check(all(cell.fg in DEFAULT_PALETTE for cell in text_cells),'only default text and standard role accents: '+label)
            minimum = min(contrast(DEFAULT_PALETTE[cell.fg], DEFAULT_BACKGROUND) for cell in text_cells)
            check(minimum >= 4.5, 'at least 4.5:1 text contrast against the default Ghostty background: '+label)
            prose_contrast = contrast(DEFAULT_PALETTE['default'], DEFAULT_BACKGROUND)
            check(any(cell.fg == 'default' for cell in text_cells) and prose_contrast >= 7,'default prose exceeds 7:1 contrast: '+label)
            if role:
                y, row = next((y, row) for y, row in enumerate(rows) if 'CURRENT TURN' in row)
                check(self.screen.buffer[y][row.index('CURRENT TURN')].fg == ('cyan' if role == 'A' else 'brown'),'current-turn heading retains actual role accent: '+label)
            styles = sorted({(cell.fg, cell.bg, cell.bold, cell.reverse) for cell in cells})
            (EVIDENCE/(label+'.colors.json')).write_text(json.dumps({'palette':'Ghostty 1.3.1 defaults', 'minimumTextContrast':round(minimum,2), 'defaultProseContrast':round(prose_contrast,2), 'styles':[{'foreground':fg,'background':bg,'bold':bold,'reverse':reverse} for fg,bg,bold,reverse in styles]},indent=2)+'\n')
            return '\n'.join(rows)
        return ''
    def stop(self, via_signal=False, shutdown_signal=signal.SIGTERM, ctrl_c=False, expected_exit=0):
        if self.process.poll() is None:
            if via_signal: self.process.send_signal(shutdown_signal)
            elif ctrl_c: self.send("\x03");time.sleep(.1);self.send("\x03")
            else: self.command('/quit')
        self.wait(lambda:self.process.poll() is not None,'shutdown')
        self.read()
        check(self.process.returncode == expected_exit,'expected exit')
        after = termios.tcgetattr(self.slave)
        # macOS may set transient PENDIN when libuv restores canonical mode.
        after[3] &= ~getattr(termios,'PENDIN',0)
        before = list(self.before);before[3] &= ~getattr(termios,'PENDIN',0)
        check(after == before,'terminal input mode restored')
        if b'\x1b[?1049h' in self.output:
            check(b'\x1b[?1049l' in self.output,'main screen restored')
            check(b'\x1b[?25h' in self.output,'cursor restored')
            if b'\x1b[>4;2m' in self.output:
                check(self.output.rfind(b'\x1b[>4;0m') > self.output.rfind(b'\x1b[>4;2m'),'keyboard protocol restored after fallback')
        if self.mode.startswith('history'):
            (EVIDENCE/(self.mode+'.ansi')).write_bytes(self.output)
        os.close(self.master); os.close(self.slave)

with tempfile.TemporaryDirectory(prefix='pi-terminal-pty-') as directory:
    root = Path(directory)
    for mode in ['tui','plain']:
        terminal = Terminal(root,mode)
        try:
            terminal.command('plan first')
            terminal.wait(lambda:bool(terminal.state().get('pendingPlan')),'pending plan')
            check(not (terminal.workspace/'result.txt').exists(),'approval required')
            terminal.command('/discard')
            terminal.wait(lambda:not terminal.state().get('pendingPlan'),'discard')
            terminal.command('plan revised')
            terminal.wait(lambda:bool(terminal.state().get('pendingPlan')),'revised plan')
            terminal.command('/approve')
            terminal.wait(lambda:terminal.state().get('status',{}).get('workflowStatus') == 'completed' and terminal.state().get('operation',{}).get('kind')=='completed','workflow')
            check((terminal.workspace/'result.txt').read_text() == 'TERMINAL_EXECUTION_OK\n','actual isolated write')
            entries = terminal.state()['conversation']
            check(sum(entry['text']=='Execution detail retained.' for entry in entries)==1,'execution prose once')
            check(sum(entry['text']=='Review detail retained.' for entry in entries)==1,'review prose once')
            check(any('TERMINAL_WORKFLOW_OK' in entry['text'] for entry in entries),'final response')
            terminal.command('slow request')
            terminal.wait(lambda:bool(terminal.state().get('liveStream')),'live progress before completion')
            if mode == 'tui':
                terminal.send('draft survives')
                terminal.send('\r')
                terminal.wait(lambda:terminal.state().get('notification',{}).get('code') == 'operation.busy','busy rejection')
                terminal.wait(lambda:terminal.state().get('operation',{}).get('kind') == 'completed','delayed completion')
                terminal.send('\r')
                terminal.wait(lambda:any(entry.get('text')=='draft survives' for entry in terminal.state().get('conversation',[])),'draft survives completion')
                terminal.wait(lambda:terminal.state().get('operation',{}).get('kind') == 'completed','draft completion')
                terminal.command('slow cancel')
                terminal.wait(lambda:bool(terminal.state().get('liveStream')),'cancel live stream')
                terminal.send('cancel draft')
                terminal.send('\x03')
                terminal.wait(lambda:terminal.state().get('operation',{}).get('kind') == 'cancelled','Ctrl+C cancellation')
                terminal.send('\r')
                terminal.wait(lambda:any(entry.get('text')=='cancel draft' for entry in terminal.state().get('conversation',[])),'draft survives cancellation')
                terminal.wait(lambda:terminal.state().get('operation',{}).get('kind') == 'completed','post cancel request')
                for cols,rows in [(120,40),(40,12),(80,24),(120,40)]:
                    terminal.size(cols,rows);time.sleep(.08);terminal.read()
                check(b'Compact terminal' in terminal.output,'small terminal notice')
                terminal.send('\x1b[200~paste 界 😀\nsecond line\x1b[201~')
                terminal.send('\x03')
                terminal.command('/sessions A')
                terminal.wait(lambda:terminal.state().get('modal',{}).get('kind') == 'sessions','sessions overlay')
                terminal.send('\x1b');time.sleep(.08)
                terminal.command('/model A')
                terminal.wait(lambda:terminal.state().get('modal',{}).get('kind') == 'settings','model overlay')
                terminal.send('\x1b');time.sleep(.08)
            else:
                terminal.command('/cancel')
                terminal.wait(lambda:terminal.state().get('operation',{}).get('kind') == 'cancelled','plain cancellation')
            if mode == 'tui':
                for stage in ['cancel-execution','cancel-review']:
                    terminal.command('plan '+stage)
                    terminal.wait(lambda:bool(terminal.state().get('pendingPlan')),'cancel stage plan')
                    terminal.command('/approve')
                    if stage == 'cancel-execution':
                        terminal.wait(lambda:any(item.get('toolName')=='bash' and item.get('status')=='active' for item in terminal.state().get('activity',{}).get('history',{}).get('B',{}).get('recent',[])),'active bash tool')
                    else:
                        terminal.wait(lambda:terminal.state().get('status',{}).get('phase')=='review','active review')
                    terminal.send('stage draft');terminal.send('\x03')
                    terminal.wait(lambda:terminal.state().get('operation',{}).get('kind')=='cancelled','stage cancellation')
                    check(not (terminal.workspace/'late.txt').exists(),'cancelled bash cannot finish mutation')
                    terminal.send('\x03')
                terminal.command('plan tool failure')
                terminal.wait(lambda:bool(terminal.state().get('pendingPlan')),'tool failure plan')
                terminal.command('/approve')
                terminal.wait(lambda:any('TERMINAL_TOOL_FAILURE' in item['text'] for item in terminal.state().get('conversation',[])),'tool failure review')
                check(terminal.state()['status']['workflowStatus']=='blocked','tool failure visible')
                terminal.command('plan review cap')
                terminal.wait(lambda:bool(terminal.state().get('pendingPlan')),'cap plan')
                terminal.command('/approve')
                terminal.wait(lambda:any('TERMINAL_REVIEW_CAP' in item['text'] for item in terminal.state().get('conversation',[])),'review cap')
                check(terminal.state()['status']['currentIteration']==2,'review cap enforced')
            terminal.command('/config timeout-ms 200')
            terminal.wait(lambda:terminal.state().get('status',{}).get('timeoutMs')==200,'timeout configured')
            terminal.command('slow deadline')
            terminal.wait(lambda:terminal.state().get('operation',{}).get('kind')=='timed_out','deadline cancellation')
            check(terminal.state()['status']['workflowStatus']=='timed_out','durable timeout outcome')
            terminal.command('/config timeout-ms 15000')
            terminal.wait(lambda:terminal.state().get('status',{}).get('timeoutMs')==15000,'timeout restored')
            terminal.command('provider failure')
            terminal.wait(lambda:terminal.state().get('operation',{}).get('kind') == 'failed','provider failure')
            terminal.command('discussion after failure')
            terminal.wait(lambda:terminal.state().get('operation',{}).get('kind') == 'completed','recovery after failure')
            terminal.command('slow shutdown')
            terminal.wait(lambda:bool(terminal.state().get('liveStream')),'shutdown during active work')
            terminal.stop(via_signal=(mode=='tui'))
        finally:
            if terminal.process.poll() is None: terminal.process.kill(); terminal.process.wait()
    repair = Terminal(root,'history-repair',size=(80,24))
    try:
        repair.command('repair fixture')
        repair.wait(lambda:any(record['kind']=='run' and record.get('phase')=='Repair' and record['outcome']['kind']=='running' for record in repair.state().get('history',{}).get('records',[])),'actual planning repair')
        repair.wait(lambda:b'Active: A - Senior / Repair' in repair.output,'honest repair role and phase')
        screen = repair.snapshot('A-repair-80x24',role='A')
        if CAPTURE: check('REPAIR / running' in screen and 'Active: A - Senior' in screen,'real repair step in current workspace')
        repair.wait(lambda:repair.state().get('operation',{}).get('kind')=='completed','repair completion')
        check([record['phase'] for record in repair.state()['history']['records'] if record['kind']=='run']==['Planning','Repair'],'planning and repair separately inspectable')
        repair.stop()
    finally:
        if repair.process.poll() is None: repair.process.kill();repair.process.wait()
    for history_mode in ['history-tui','plain']:
        # A separate plain fixture instance gets its own paths; the CLI mode stays plain.
        if history_mode == 'plain':
            history_root = root/'history-plain';history_root.mkdir()
        else: history_root = root
        terminal = Terminal(history_root,history_mode,size=(120,40))
        try:
            (terminal.workspace/'evidence.txt').write_text('\n'.join(f'safe retained line {i} 界 é 😀' for i in range(300))+'\n\x1b]52;c;DUMMY_CLIPBOARD\x07\x1b[999;999HSAFE_TAIL\n')
            terminal.command('seed discussion')
            terminal.wait(lambda:terminal.state().get('operation',{}).get('kind')=='completed','seed previous operator turn')
            terminal.command('plan history stress')
            terminal.wait(lambda:bool(terminal.state().get('pendingPlan')),'stress pending plan')
            plan_turn = terminal.state()['history']['currentTurnId']
            terminal.command('/approve')
            terminal.wait(lambda:any(record['kind']=='run' and record.get('role')=='B' and record['outcome']['kind']=='running' for record in terminal.state().get('history',{}).get('records',[])),'real B run')
            if history_mode != 'plain':
                terminal.wait(lambda:b'Active: B - Junior' in terminal.output,'B active label')
                screen = terminal.snapshot('B-execution-120x40',role='B')
                if CAPTURE: check('CURRENT TURN' in screen and 'HISTORY' in screen,'selected wide layout')
                terminal.size(80,24);terminal.snapshot('B-execution-80x24',role='B')
            terminal.wait(lambda:any(record['kind']=='run' and record.get('role')=='A' and record.get('phase')=='Review' and record['outcome']['kind']=='running' for record in terminal.state().get('history',{}).get('records',[])),'real A review run')
            if history_mode != 'plain':
                terminal.wait(lambda:b'Active: A - Senior' in terminal.output,'A active label')
                terminal.size(120,40);terminal.snapshot('A-review-120x40',role='A')
            terminal.wait(lambda:terminal.state().get('operation',{}).get('kind')=='completed','history stress complete')
            history = terminal.state()['history']; records = history['records']
            calls = [record for record in records if record['kind']=='tool']
            runs = [record for record in records if record['kind']=='run']
            check(b'\x1b[36;49m' in terminal.output and b'\x1b[33;49m' in terminal.output,'standard cyan and amber role styles reach the real TTY') if history_mode != 'plain' else None
            check(history['currentTurnId']==plan_turn,'approval retains originating operator turn')
            check(len(calls)==12,'all twelve calls retained')
            check(len([call for call in calls if call['outcome']['kind']=='failed'])==1,'failed call retained')
            check([run['phase'] for run in runs if run['parentId']==plan_turn]==['Planning','Execution','Review'],'individual planning execution and review runs')
            check(all(record['outcome']['kind']!='running' for record in records),'no stale running records after completion')
            first = calls[0]
            files = list(terminal.state_root.rglob('*.jsonl'))
            before = {str(path):hashlib.sha256(path.read_bytes()).hexdigest() for path in files}
            sessions = [(runtime['role'],runtime['sessionId']) for runtime in terminal.state()['status']['runtimes']]
            if history_mode == 'plain':
                terminal.command('/history')
                terminal.wait(lambda:terminal.state().get('modal',{}).get('kind')=='records','plain shared history')
                terminal.command('/inspect '+first['id']+' output 220')
                terminal.wait(lambda:terminal.state().get('modal',{}).get('kind')=='record_detail','plain range inspection')
                check('safe retained line 230' in terminal.state()['modal']['content'],'plain full output beyond preview')
                failed = next(call for call in calls if call['outcome']['kind']=='failed')
                terminal.command('/inspect '+failed['id']+' output')
                terminal.wait(lambda:'Isolated tool failed' in terminal.state().get('modal',{}).get('content',''),'plain failed output inspection')
                check('Isolated tool failed' in terminal.state()['modal']['content'],'failed retained result individually readable')
            else:
                terminal.send('历史 é 😀 draft')
                terminal.send('\x1b[17~');time.sleep(.08)
                terminal.send('\x1b[H');terminal.send('\x1b[B');terminal.send('\x1b[B');terminal.send('\r');time.sleep(.1)
                terminal.send('3');terminal.wait(lambda:b'safe retained line' in terminal.output,'tool inspector output');terminal.send('\x1b[F');terminal.wait(lambda:b'SAFE_TAIL' in terminal.output,'retained output tail')
                screen_before = terminal.snapshot('historical-tool-120x40')
                terminal.send('\x1bOP')
                terminal.wait(lambda:terminal.state().get('modal',{}).get('kind')=='help','F1 over inspector')
                terminal.snapshot('help-over-inspector-120x40')
                terminal.send('\x1b');time.sleep(.1)
                screen_after = terminal.snapshot('restored-inspector-120x40')
                if CAPTURE:
                    check(screen_after==screen_before,'help restores inspector selection scroll and draft')
                    check('SAFE_TAIL' in screen_after,'full retained tool tail reachable')
                    check('历史 é 😀 draft' in screen_after,'draft survives inspection and help')
                terminal.size(80,24)
                screen = terminal.snapshot('historical-tool-80x24')
                if CAPTURE: check('READ-ONLY INSPECTOR' in screen and 'Idle' in screen,'narrow inspector keeps honest active pointer')
                terminal.send('\x1b');time.sleep(.1)
                for _ in range(4): terminal.send('\x1b[B')
                terminal.send('\r');time.sleep(.1);terminal.send('3')
                terminal.wait(lambda:b'Isolated tool failed' in terminal.output,'failed tool retained output')
                screen = terminal.snapshot('failed-tool-80x24')
                if CAPTURE: check('output / failed' in screen and 'Isolated tool failed' in screen,'failed output remains independently inspectable')
                terminal.send('\x1b');time.sleep(.1)
                terminal.send('\x1b[17~');terminal.send('\r');time.sleep(.1)
                screen = terminal.snapshot('history-list-80x24')
                if CAPTURE: check('HISTORY [focus]' in screen and 'seed discussion' in screen,'narrow focused control opens previous-turn history')
                terminal.send(' ');terminal.send('\x1b[B');terminal.send('\r');time.sleep(.1);terminal.send('3')
                terminal.read();time.sleep(.1)
                screen = terminal.snapshot('previous-A-run-80x24')
                if CAPTURE: check('A - Senior / run' in screen and 'TERMINAL_DISCUSSION_OK' in screen,'past operator turn run prose independently inspectable')
                terminal.send('\x1b');time.sleep(.1);terminal.read()
                terminal.send('\x1b');time.sleep(.1);terminal.read();terminal.send('\x1b');time.sleep(.1);terminal.read()
                check({str(path):hashlib.sha256(path.read_bytes()).hexdigest() for path in files}==before,'TUI inspection and help make zero persisted writes')
                terminal.send('\r')
                terminal.wait(lambda:any(entry['text']=='历史 é 😀 draft' for entry in terminal.state().get('conversation',[])),'draft accepted after closing inspection')
                terminal.wait(lambda:terminal.state().get('operation',{}).get('kind')=='completed','draft completion')
            if history_mode == 'plain':
                check({str(path):hashlib.sha256(path.read_bytes()).hexdigest() for path in files}==before,'plain inspection makes zero persisted writes')
            else:
                # The explicit submission above writes its new turn. Check the session bindings separately.
                check(all(call['id'] in {record['id'] for record in terminal.state()['history']['records']} for call in calls),'calls survive subsequent operator turn')
            check([(runtime['role'],runtime['sessionId']) for runtime in terminal.state()['status']['runtimes']]==sessions,'record inspection never switches sessions')
            check(b'\x1b]52;c;DUMMY_CLIPBOARD' not in terminal.output and b'\x1b[999;999H' not in terminal.output,'unsafe tool ANSI never reaches terminal')
            terminal.stop()
        finally:
            if terminal.process.poll() is None: terminal.process.kill();terminal.process.wait()
    for shutdown_signal in [signal.SIGHUP,signal.SIGINT]:
        probe = Terminal(root,'signal-'+str(shutdown_signal))
        try: probe.stop(via_signal=True,shutdown_signal=shutdown_signal)
        finally:
            if probe.process.poll() is None: probe.process.kill();probe.process.wait()
    probe = Terminal(root,'ctrl-c-exit')
    try: probe.stop(ctrl_c=True)
    finally:
        if probe.process.poll() is None: probe.process.kill();probe.process.wait()
    probe = Terminal(root,'startup-failure',startup_failure=True)
    probe.stop(expected_exit=1)
    report = {'outcome':'passed' ,'ptyAssertions':checks,'interfaces':['tui','plain'],'provider':'installed Pi with dummy brokers and Responses/Chat Completions fixtures','screenCapture':CAPTURE,'evidenceDirectory':str(EVIDENCE)}
    (EVIDENCE/'report.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report))
