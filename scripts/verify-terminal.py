#!/usr/bin/env python3
"""Drive real Pi runtimes and both terminal interfaces in isolated PTYs. No API key."""
import codecs
import hashlib
import html
import fcntl
import json
import os
from pathlib import Path
import pty
import re
import select
import signal
import struct
import subprocess
import sys
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
DEFAULT_PALETTE = {'default': 'ffffff', 'white': 'c5c8c6', 'cyan': '8abeb7', 'brown': 'f0c674'}
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

def stable_screen(screen):
    # The pinned clock can advance while browsing; compare all other text and geometry.
    return re.sub(r'\d+s elapsed(?: / last event \d+s ago)?', 'CLOCK', screen)

def controls_visible(rows):
    return any('Esc controls' in row or 'h help' in row or 'Letter or Up/Down' in row or 'Esc cancel' in row or 'Quit? y confirm' in row for row in rows)

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
        else: self.wait(lambda: b'Enter submit' in self.output and len(self.state().get('status',{}).get('runtimes',[])) == 2 and self.state().get('modal',{}).get('kind') == 'none', 'startup')
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
        if self.screen and role: self.wait(lambda:any('CURRENT REQUEST' in row for row in self.screen.display),'current request heading rendered before role capture')
        if self.screen:
            self.wait(lambda:controls_visible(self.screen.display),'controls repainted before capture')
            rows = self.screen.display
            check(len(rows)==self.screen.lines,'captured screen row budget')
            check(all(wcswidth(row)<=self.screen.columns for row in rows),'captured screen display-cell budget')
            check(controls_visible(rows),'controls remain visible in captured screen')
            (EVIDENCE/(label+'.screen.txt')).write_text('\n'.join(rows)+'\n')
            cells = [self.screen.buffer[y][x] for y in range(self.screen.lines) for x in range(self.screen.columns)]
            text_cells = [cell for cell in cells if cell.data.strip()]
            check(all(cell.bg == 'default' for cell in cells),'no colored body fill: '+label+' '+repr({cell.bg for cell in cells}))
            editor_borders = [y for y, row in enumerate(rows) if row.startswith('──')]
            editor_rows = range(editor_borders[-2] + 1, editor_borders[-1]) if len(editor_borders) >= 2 else range(0)
            check(all(not self.screen.buffer[y][x].reverse for y in range(self.screen.lines) if y not in editor_rows for x in range(self.screen.columns) if self.screen.buffer[y][x].data.strip()),'no inverse text outside the editor cursor: '+label)
            check(all(cell.fg in DEFAULT_PALETTE for cell in text_cells),'only default text and standard ANSI accents: '+label)
            minimum = min(contrast(DEFAULT_PALETTE[cell.fg], DEFAULT_BACKGROUND) for cell in text_cells)
            check(minimum >= 4.5, 'at least 4.5:1 text contrast against the default Ghostty background: '+label)
            prose_contrast = contrast(DEFAULT_PALETTE['default'], DEFAULT_BACKGROUND)
            check(any(cell.fg == 'default' for cell in text_cells) and prose_contrast >= 7,'default prose exceeds 7:1 contrast: '+label)
            if role:
                y, row = next((y, row) for y, row in enumerate(rows) if 'CURRENT REQUEST' in row)
                check(self.screen.buffer[y][row.index('CURRENT REQUEST')].fg == ('cyan' if role == 'A' else 'brown'),'current-turn heading retains actual role accent: '+label)
            activity_heading = next(((y, row) for y, row in enumerate(rows) if 'Current /' in row), None)
            if activity_heading:
                y, row = activity_heading
                for recent_y, recent_row in enumerate(rows):
                    if 'recent call' in recent_row:
                        check(self.screen.buffer[recent_y][recent_row.index('recent call')].fg == self.screen.buffer[y][row.index('Current /')].fg, 'recent calls match the current agent accent: '+label)
            styles = sorted({(cell.fg, cell.bg, cell.bold, cell.reverse) for cell in cells})
            (EVIDENCE/(label+'.colors.json')).write_text(json.dumps({'palette':'Ghostty 1.3.1 defaults', 'minimumTextContrast':round(minimum,2), 'defaultProseContrast':round(prose_contrast,2), 'styles':[{'foreground':fg,'background':bg,'bold':bold,'reverse':reverse} for fg,bg,bold,reverse in styles]},indent=2)+'\n')
            rendered_rows = []
            for y in range(self.screen.lines):
                spans = []
                previous_style = None
                text = ''
                for x in range(self.screen.columns):
                    cell = self.screen.buffer[y][x]
                    color = DEFAULT_PALETTE.get(cell.fg, DEFAULT_PALETTE['default'])
                    style = f'color:#{color};font-weight:{700 if cell.bold else 400}'
                    if cell.reverse: style = 'color:#282c34;background:white'
                    if style != previous_style and text:
                        spans.append(f'<span style="{previous_style}">{html.escape(text)}</span>')
                        text = ''
                    previous_style = style
                    text += cell.data
                if text: spans.append(f'<span style="{previous_style}">{html.escape(text)}</span>')
                rendered_rows.append(''.join(spans))
            document = '<!doctype html><meta charset="utf-8"><title>'+html.escape(label)+'</title><style>body{margin:0;padding:16px;background:#282c34;color:white}pre{font:13px/1.4 Menlo,monospace;white-space:pre;margin:0}p{font:13px system-ui}</style><p>Actual Pi fixture PTY capture: '+html.escape(label)+f' · {self.screen.columns}×{self.screen.lines}</p><pre>'+"\n".join(rendered_rows)+'</pre>'
            (EVIDENCE/(label+'.html')).write_text(document)
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
            if b'\x1b[?1006h' in self.output:
                check(self.output.rfind(b'\x1b[?1006l') > self.output.rfind(b'\x1b[?1006h'),'SGR mouse reporting restored')
                check(self.output.rfind(b'\x1b[?1000l') > self.output.rfind(b'\x1b[?1000h'),'mouse tracking restored')
            if b'\x1b[>4;2m' in self.output:
                check(self.output.rfind(b'\x1b[>4;0m') > self.output.rfind(b'\x1b[>4;2m'),'keyboard protocol restored after fallback')
        if self.mode.startswith('history'):
            (EVIDENCE/(self.mode+'.ansi')).write_bytes(self.output)
        os.close(self.master); os.close(self.slave)

def verify_stream_failure(root):
    for stream_mode in ['stream-failure', 'plain-stream-failure']:
        terminal = Terminal(root, stream_mode, (120,80))
        try:
            terminal.command('plan stream failure')
            terminal.wait(lambda:bool(terminal.state().get('pendingPlan')),'stream failure approval boundary')
            terminal.command('/approve')
            terminal.wait(lambda:terminal.state().get('operation',{}).get('kind')=='failed','B stream interruption after check-in')
            state = terminal.state()
            activity = state['currentActivity']
            check(activity['owner']['role']=='B' and activity['phase']=='Execution','failure retains B ownership after A check-in')
            check('request interrupted' in activity['action']['failure']['reason'],'specific safe failure retained')
            check((terminal.workspace/'result.txt').read_text()=='write preserved before interruption','earlier write survives provider failure')
            check(not (terminal.workspace/'must-not-exist.txt').exists(),'incomplete streamed tool never executes')
            runs = [record for record in state['history']['records'] if record['kind']=='run']
            check(any(run['phase']=='Check-in' and run['outcome']['kind']=='completed' for run in runs),'A check-in succeeded before B failure')
            if stream_mode == 'stream-failure':
                for cols,rows in [(120,80),(80,24),(40,12)]:
                    terminal.size(cols,rows)
                    screen = terminal.snapshot(f'stream-failure-{cols}x{rows}')
                    if CAPTURE: check('LM Studio request interrupted' in screen and ('Agent B' in screen or 'B - Junior' in screen),'failure role and cause visible at target size')
                terminal.send('\x1bOS')
                terminal.snapshot('stream-failure-history-40x12')
            else:
                terminal.read()
                check(b'Agent B / Execution: Request failed / LM Studio request interrupted' in terminal.output,'plain mode prints role and cause')
            check(b'private upstream detail' not in terminal.output,'raw provider errors stay private')
            terminal.stop(via_signal=stream_mode == 'stream-failure')
        finally:
            if terminal.process.poll() is None: terminal.process.kill();terminal.process.wait()

def verify_cloud_stream_failure(root):
    for stream_mode in ['cloud-stream-failure', 'plain-cloud-stream-failure']:
        terminal = Terminal(root, stream_mode, (120,80))
        try:
            terminal.command('cloud stream failure')
            terminal.wait(lambda:terminal.state().get('operation',{}).get('kind')=='failed','A cloud stream interruption')
            state = terminal.state()
            activity = state['currentActivity']
            check(activity['owner']['role']=='A' and activity['phase']=='Planning','failure retains A planning ownership')
            check('OpenAI request interrupted' in activity['action']['failure']['reason'],'specific cloud stream failure retained')
            runs = [record for record in state['history']['records'] if record['kind']=='run']
            check(len(runs)==1 and runs[0]['outcome']['kind']=='failed','cloud failure stops without repair or replay')
            check(not state.get('pendingPlan'),'cloud failure does not create an approval plan')
            if stream_mode == 'cloud-stream-failure':
                for cols,rows in [(120,80),(80,24),(40,12)]:
                    terminal.size(cols,rows)
                    screen = terminal.snapshot(f'cloud-stream-failure-{cols}x{rows}')
                    if CAPTURE: check('OpenAI request interrupted' in screen and ('Agent A' in screen or 'A - Senior' in screen),'cloud failure role and cause visible at target size')
            else:
                terminal.read()
                check(b'Agent A / Planning: Request failed / OpenAI request interrupted' in terminal.output,'plain mode prints cloud failure role and cause')
            check(b'private upstream detail' not in terminal.output and b'incomplete' not in terminal.output,'cloud error details and partial SSE stay private')
            terminal.stop(via_signal=stream_mode == 'cloud-stream-failure')
        finally:
            if terminal.process.poll() is None: terminal.process.kill();terminal.process.wait()

if sys.argv[1:] == ['--provider-stream-only']:
    with tempfile.TemporaryDirectory(prefix='pi-stream-terminal-') as directory:
        verify_stream_failure(Path(directory))
        verify_cloud_stream_failure(Path(directory))
    print(json.dumps({'outcome':'passed','scope':'provider-stream','ptyAssertions':checks,'interfaces':['tui','plain'],'screenCapture':CAPTURE}))
    raise SystemExit(0)

with tempfile.TemporaryDirectory(prefix='pi-terminal-pty-') as directory:
    root = Path(directory)
    for mode in ['tui','plain']:
        terminal = Terminal(root,mode)
        try:
            fresh_b = next(runtime for runtime in terminal.state()['status']['runtimes'] if runtime['role']=='B')
            check(not Path(fresh_b['sessionFile']).exists(),'unused B session has not been flushed to disk')
            terminal.command('/skills')
            terminal.wait(lambda:b'TERMINAL_SKILL_OK' in terminal.output and terminal.state().get('operation',{}).get('kind')=='completed','skill catalog through terminal')
            catalog_turn = terminal.state()['history']['currentTurnId']
            terminal.command('/skill:terminal-fixture')
            terminal.wait(lambda:terminal.state()['history']['currentTurnId'] != catalog_turn and terminal.state().get('operation',{}).get('kind')=='completed','skill invocation through terminal')
            terminal.wait(lambda:any('TERMINAL_SKILL_INSTRUCTIONS_OK' in entry.get('text','') for entry in terminal.state()['conversation']),'actual skill instructions received by Pi and rendered')
            check(any('TERMINAL_SKILL_INSTRUCTIONS_OK' in entry.get('text','') for entry in terminal.state()['conversation']),'actual skill instructions retained')
            check(not (terminal.workspace/'result.txt').exists(),'skill request does not approve B')
            if mode == 'tui': terminal.snapshot('installed-skill-tui')
            terminal.command('/model B lm-studio/qwen3-coder-next save')
            terminal.wait(lambda:any(runtime['role']=='B' and runtime.get('modelCanonical')=='lm-studio/qwen3-coder-next' for runtime in terminal.state().get('status',{}).get('runtimes',[])),'change unused B model through terminal command')
            check(next(runtime for runtime in terminal.state()['status']['runtimes'] if runtime['role']=='B')['sessionId']==fresh_b['sessionId'],'model change retains the unflushed B session')
            terminal.command('plan first')
            terminal.wait(lambda:bool(terminal.state().get('pendingPlan')),'pending plan')
            check(not (terminal.workspace/'result.txt').exists(),'approval required')
            terminal.command('/discard')
            terminal.wait(lambda:not terminal.state().get('pendingPlan'),'discard')
            terminal.command('plan revised')
            terminal.wait(lambda:bool(terminal.state().get('pendingPlan')),'revised plan')
            terminal.command('/approve')
            terminal.wait(lambda:terminal.state().get('status',{}).get('workflowStatus') == 'completed' and terminal.state().get('operation',{}).get('kind')=='completed' and any('TERMINAL_WORKFLOW_OK' in entry.get('text','') for entry in terminal.state().get('conversation',[])),'workflow and final response hydrated')
            check((terminal.workspace/'result.txt').read_text() == 'TERMINAL_EXECUTION_OK\n','actual isolated write')
            entries = terminal.state()['conversation']
            check(sum(entry['text']=='Execution detail retained.' for entry in entries)==1,'execution prose once')
            check(sum(entry['text']=='Review detail retained.' for entry in entries)==1,'review prose once')
            check(any('TERMINAL_WORKFLOW_OK' in entry['text'] for entry in entries),'final response')
            for commands in [['/new A','/new B'], ['/new']]:
                before = terminal.state()
                for command in commands:
                    previous = [(r['role'],r['sessionId']) for r in terminal.state()['status']['runtimes']]
                    notification = terminal.state().get('notification',{}).get('id')
                    terminal.command(command)
                    terminal.wait(lambda:[(r['role'],r['sessionId']) for r in terminal.state()['status']['runtimes']]!=previous and terminal.state().get('notification',{}).get('id')!=notification and terminal.state().get('notification',{}).get('code')==('conversation.created' if command=='/new' else 'runtime.session.created'),'fresh sessions')
                terminal.wait(lambda:terminal.state().get('operation',{}).get('kind')=='idle' and not terminal.state().get('history',{}).get('currentTurnId'),'blank current conversation')
                check(terminal.state()['history']['records']==before['history']['records'],'new conversation preserves all retained history')
                check(not any(entry.get('text')=='plan first' for entry in terminal.state().get('conversation',[])),'old conversation removed from current view')
                expected = b'Created new session for role' if mode=='plain' and len(commands)>1 else b'New conversation'
                terminal.wait(lambda:expected in terminal.output,'fresh conversation visibly acknowledged')
                terminal.command('fresh discussion')
                terminal.wait(lambda:terminal.state().get('operation',{}).get('kind')=='completed','fresh conversation accepts input')
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
                terminal.send('\x1bx')
                terminal.wait(lambda:terminal.state().get('operation',{}).get('kind') == 'cancelled','controls-menu cancellation')
                terminal.send('\r')
                terminal.wait(lambda:any(entry.get('text')=='cancel draft' for entry in terminal.state().get('conversation',[])),'draft survives cancellation')
                terminal.wait(lambda:terminal.state().get('operation',{}).get('kind') == 'completed','post cancel request')
                for cols,rows in [(120,40),(40,12),(80,24),(120,40)]:
                    terminal.size(cols,rows);time.sleep(.08);terminal.read()
                check(b'Current activity' in terminal.output,'current action remains visible after compact resize')
                terminal.send('\x1b[200~paste 界 😀\nsecond line\x1b[201~')
                terminal.send('\x03')
                terminal.command('/sessions A')
                terminal.wait(lambda:terminal.state().get('modal',{}).get('kind') == 'sessions','sessions overlay')
                terminal.send('\x1b');time.sleep(.08)
                terminal.send('picker draft survives')
                terminal.send('\x1bm')
                terminal.wait(lambda:terminal.state().get('modal',{}).get('kind') == 'model_picker','Esc m model overlay')
                terminal.size(80,24);time.sleep(.1)
                screen = terminal.snapshot('model-picker-a-80x24')
                if CAPTURE:
                    for text in ['GPT-6.1 Sol','GPT-5.6 Terra','GPT-6 Luna','Low','Medium','High','Enter apply','Esc back']:
                        check(text in screen,'visible picker choice/control: '+text)
                terminal.send('\x1b[H');terminal.send('\x1b[D');terminal.send('s')
                terminal.send('h')
                terminal.wait(lambda:terminal.state().get('modal',{}).get('kind')=='help','help over picker')
                terminal.send('\x1b');terminal.size(120,40);time.sleep(.1)
                terminal.snapshot('model-picker-a-120x40')
                terminal.send('\r')
                terminal.wait(lambda:any(runtime['role']=='A' and runtime.get('modelCanonical')=='openai/gpt-6.1-sol' and runtime.get('thinking')=='medium' for runtime in terminal.state()['status']['runtimes']),'selected GPT and medium reasoning')
                terminal.wait(lambda:terminal.state().get('modal',{}).get('kind')=='none','model ready')
                check('ready' in terminal.state()['notification']['message'],'ready notification after model selection')
                terminal.send('\x1bm');terminal.wait(lambda:terminal.state().get('modal',{}).get('kind')=='model_picker','reopen model picker')
                terminal.send('b');terminal.wait(lambda:terminal.state().get('modal',{}).get('catalog',{}).get('role')=='B','B picker tab')
                screen = terminal.snapshot('model-picker-b-120x40')
                if CAPTURE: check('google/gemma-4-e4b' in screen and 'Not loaded' in screen,'all downloaded models and readiness shown')
                terminal.send('\x1b[H');terminal.send('s');terminal.send('\r')
                terminal.wait(lambda:terminal.state().get('modal',{}).get('progress',{}).get('phase')=='loading','B model loading')
                terminal.snapshot('model-picker-loading-120x40')
                terminal.send('\x1b')
                terminal.wait(lambda:terminal.state().get('modal',{}).get('kind')=='none','B cancellation finished')
                check(any(runtime['role']=='B' and runtime.get('modelCanonical')=='lm-studio/qwen3-coder-next' for runtime in terminal.state()['status']['runtimes']),'cancel retains previous B selection')
                terminal.send('\r')
                terminal.wait(lambda:any(entry.get('text')=='picker draft survives' for entry in terminal.state().get('conversation',[])),'model selection and cancellation preserve draft')
                terminal.wait(lambda:terminal.state().get('operation',{}).get('kind')=='completed','post picker draft completion')
                terminal.send('\x1bOR')
                terminal.wait(lambda:terminal.state().get('modal',{}).get('kind')=='model_picker','reasoning picker open')
                terminal.send('b')
                terminal.wait(lambda:terminal.state().get('modal',{}).get('catalog',{}).get('role')=='B','reasoning B tab')
                terminal.send('\x1b[H');time.sleep(.1)
                screen = terminal.snapshot('qwen38-reasoning-120x40')
                if CAPTURE:
                    for text in ['Off','Low','Medium','[Xhigh]','reasoning']:
                        check(text in screen,'Qwen3.8 reasoning choice visible: '+text)
                terminal.send('\x1b[D');terminal.send('\x1b[C');terminal.send('\r')
                terminal.wait(lambda:any(runtime['role']=='B' and runtime.get('modelCanonical')=='lm-studio/qwen/qwen3.8-27b' and runtime.get('thinking')=='xhigh' for runtime in terminal.state()['status']['runtimes']),'Qwen3.8 xhigh applied from TUI')
                terminal.wait(lambda:terminal.state().get('modal',{}).get('kind')=='none','reasoning picker completed')

            else:
                terminal.command('/cancel')
                terminal.wait(lambda:terminal.state().get('operation',{}).get('kind') == 'cancelled','plain cancellation')
                terminal.command('/model A')
                terminal.wait(lambda:terminal.state().get('modal',{}).get('kind')=='model_picker','plain model choices')
                check('GPT-6.1 Sol' in terminal.state()['modal']['content'] and '/thinking A low|medium|high' in terminal.state()['modal']['content'],'plain models and reasoning controls remain readable')
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
    controls = Terminal(root, 'controls')
    try:
        controls.send('abc');controls.send('\x1b[D');controls.send('\x1b')
        controls.wait(lambda:b'Letter or Up/Down' in controls.output,'visible controls menu')
        menu = controls.snapshot('controls-menu-80x24')
        if CAPTURE:
            for label in ['h  Help','m  Models','a  Activity','w  Workspace','r  Request history','p  Previous prompts','n  Newline','x  Cancel work','q  Quit']:
                check(label in menu,'visible portable action: '+label)
        controls.size(40,12);time.sleep(.1)
        controls.send('\x1b[A');time.sleep(.1)
        small = controls.snapshot('controls-menu-40x12')
        if CAPTURE: check('> q  Quit' in small,'selected control remains visible after resize')
        controls.size(80,24);time.sleep(.1)
        controls.send('nX\r')
        controls.wait(lambda:any(entry.get('text')=='ab\nXc' for entry in controls.state().get('conversation',[])),'menu newline retains the cursor')
        controls.wait(lambda:controls.state().get('operation',{}).get('kind')=='completed','newline request completes')
        controls.send('saved draft');controls.send('\x1bp');time.sleep(.1)
        controls.send('\x1b[B');controls.send('\x1b[B');controls.send('\r')
        controls.wait(lambda:any(entry.get('text')=='saved draft' for entry in controls.state().get('conversation',[])),'prompt history restores the draft')
        controls.wait(lambda:controls.state().get('operation',{}).get('kind')=='completed','restored draft completes')
        controls.send('last draft');controls.send('\x1bq')
        controls.wait(lambda:b'Quit pi-dual?' in controls.output,'quit confirmation')
        controls.send('\x1b[200~y\x1b[201~');controls.send('\r');time.sleep(.1);controls.read()
        check(controls.process.poll() is None,'paste and Enter cannot confirm quit')
        controls.send('n');time.sleep(.1)
        restored = controls.snapshot('controls-restored-draft-80x24')
        if CAPTURE: check('last draft' in restored,'declining quit preserves draft')
        controls.send('\x1bq');controls.send('y')
        controls.wait(lambda:controls.process.poll() is not None,'confirmed quit')
        controls.stop()
    finally:
        if controls.process.poll() is None: controls.process.kill();controls.process.wait()
    repair = Terminal(root,'history-repair',size=(80,24))
    try:
        repair.command('repair fixture')
        repair.wait(lambda:any(record['kind']=='run' and record.get('phase')=='Repair' and record['outcome']['kind']=='running' for record in repair.state().get('history',{}).get('records',[])),'actual planning repair')
        repair.wait(lambda:repair.state().get('currentActivity',{}).get('owner',{}).get('role')=='A' and repair.state().get('currentActivity',{}).get('phase')=='Repair','honest repair role and phase')
        screen = repair.snapshot('A-repair-80x24',role='A')
        if CAPTURE: check('Repair' in screen and 'Current / A - Senior' in screen,'real repair step in current workspace')
        repair.wait(lambda:repair.state().get('operation',{}).get('kind')=='completed','repair completion')
        check([record['phase'] for record in repair.state()['history']['records'] if record['kind']=='run']==['Planning','Repair'],'planning and repair separately inspectable')
        repair.stop()
    finally:
        if repair.process.poll() is None: repair.process.kill();repair.process.wait()
    for repair_mode in ['bounded-repair', 'plain-repair']:
        bounded = Terminal(root,repair_mode,size=(80,24))
        try:
            bounded.command('bounded repair fixture')
            bounded.wait(lambda:bounded.state().get('status',{}).get('responseProgress',{}).get('attempt') == 4,'fourth bounded response attempt')
            bounded.wait(lambda:b'Agent A planning response attempt 4/10' in bounded.output,'visible bounded response progress')
            bounded.wait(lambda:bounded.state().get('operation',{}).get('kind') == 'completed','tenth-attempt success')
            check(bounded.state()['status']['responseProgress']['attempt'] == 10,'success on attempt ten')
            check(bounded.state()['status']['responseProgress']['repairCount'] == 9,'nine repair requests')
            check(len([record for record in bounded.state()['history']['records'] if record['kind']=='run']) == 10,'ten response runs, no eleventh')
            bounded.command('exhaust repair fixture')
            bounded.wait(lambda:bounded.state().get('operation',{}).get('kind') == 'running','exhaustion fixture started')
            if repair_mode != 'plain-repair': bounded.send('preserved repair draft')
            bounded.wait(lambda:bounded.state().get('operation',{}).get('kind') == 'failed','tenth-attempt exhaustion')
            check(bounded.process.poll() is None,'terminal stays open after repair exhaustion')
            progress = bounded.state()['status']['responseProgress']
            check(progress['attempt'] == 10 and progress['repairCount'] == 9,'exact exhausted attempt accounting')
            check('invalid' in progress['reason'],'final validation reason is visible in status')
            current = next(record for record in bounded.state()['history']['records'] if record['id']==bounded.state()['history']['currentTurnId'])
            check(current['responseProgress']['reason'] == progress['reason'],'history retains final validation reason')
            if repair_mode != 'plain-repair':
                bounded.send('\r')
                bounded.wait(lambda:any(entry.get('text') == 'preserved repair draft' for entry in bounded.state().get('conversation',[])),'failure preserves composer draft for explicit submission')
                bounded.wait(lambda:bounded.state().get('operation',{}).get('kind') == 'completed','explicit work after exhaustion')
                check(current['id'] in {record['id'] for record in bounded.state()['history']['records']},'failed history survives explicit later work')
            bounded.command('/status')
            if repair_mode != 'plain-repair':
                bounded.wait(lambda:bounded.state().get('modal',{}).get('kind') == 'status','status after response failure')
                bounded.send('\x1b')
                bounded.wait(lambda:bounded.state().get('modal',{}).get('kind') == 'none','status modal closed')
            else: bounded.wait(lambda:b'responseProgress' in bounded.output,'plain status includes response progress')
            bounded.stop()
        finally:
            if bounded.process.poll() is None: bounded.process.kill();bounded.process.wait()
    for cols, rows in [(80,24),(120,40)]:
        scrolling = Terminal(root,f'scrolling-{cols}',size=(cols,rows))
        try:
            scrolling.command('scroll fixture')
            scrolling.wait(lambda:scrolling.state().get('operation',{}).get('kind')=='completed','scrollable prose fixture')
            scrolling.wait(lambda:b'SCROLL_LINE_59' in scrolling.output,'latest prose rendered')
            check(b'\x1b[?1000h\x1b[?1006h' in scrolling.output,'mouse reporting enabled in real TTY')
            scrolling.send('scroll draft')
            following = scrolling.snapshot(f'scroll-{cols}-following')
            scrolling.send('\x1b[5~')
            paused = scrolling.snapshot(f'scroll-{cols}-paused')
            if CAPTURE:
                position = lambda screen: int(re.search(r'↑ (\d+)',screen).group(1))
                check('SCROLL_LINE_59' in following and 'Following' in following,'initially follows latest prose')
                check(position(paused)<position(following) and 'SCROLL_LINE_59' not in paused,'PageUp scrolls prose from editor focus')
                check('Paused' in paused and 'Wheel scroll' in paused,'scroll controls and follow state visible')
                scrolling.send('\x1b[<64;50;8M')
                wheel = scrolling.snapshot(f'scroll-{cols}-wheel')
                check(position(wheel)==max(0,position(paused)-3),'SGR wheel scrolls three lines in real TTY')
                scrolling.send('\x1b[<65;50;8M')
                check(position(scrolling.snapshot(f'scroll-{cols}-wheel-down'))==position(paused),'wheel down returns three lines')
                scrolling.send('\x1b[1;2A')
                check(position(scrolling.snapshot(f'scroll-{cols}-line-up'))==position(paused)-1,'Shift+Up scrolls one line in real TTY')
                scrolling.send('\x1b[1;2B')
                check(position(scrolling.snapshot(f'scroll-{cols}-line-down'))==position(paused),'Shift+Down returns one line')
                scrolling.send(f'\x1b[<64;50;{rows}M')
                check(position(scrolling.snapshot(f'scroll-{cols}-outside'))==position(paused),'wheel outside workspace leaves viewport alone')
            scrolling.send('\x1b[F')
            restored = scrolling.snapshot(f'scroll-{cols}-restored')
            if CAPTURE:
                check('SCROLL_LINE_59' in restored and 'Following' in restored,'End resumes following from editor focus')
                check('scroll draft' in restored and '<64;' not in restored,'draft survives keyboard and wheel scrolling')
            check(len([entry for entry in scrolling.state()['conversation'] if entry['kind']=='operator_message'])==1,'scrolling never submits draft')
            scrolling.send('\x03')
            scrolling.stop()
        finally:
            if scrolling.process.poll() is None: scrolling.process.kill();scrolling.process.wait()
    for cols, rows in [(80,24),(120,40)]:
        chooser = Terminal(root,f'history-chooser-{cols}',size=(cols,rows))
        try:
            chooser.command('previous chooser request')
            chooser.wait(lambda:chooser.state().get('operation',{}).get('kind')=='completed','chooser retained request')
            chooser.command('plan chooser request')
            chooser.wait(lambda:bool(chooser.state().get('pendingPlan')),'chooser pending plan')
            if CAPTURE:
                chooser.wait(lambda:any('Plan ready / waiting' in row for row in chooser.screen.display),'chooser plan milestone rendered')
                chooser.send('\x1bw');chooser.send('g');chooser.send('\x1be')
                chooser.wait(lambda:any('Plan prose retained.' in row for row in chooser.screen.display),'planning prose remains reachable above the milestone')
            chooser.send('\x1b[200~ab\ncd\x1b[201~');chooser.send('\x1b[D')
            closed = chooser.snapshot(f'chooser-{cols}-closed')
            identity = lambda state: (state['history']['currentTurnId'],state.get('pendingPlan'),[(r['role'],r['sessionId']) for r in state['status']['runtimes']])
            before_identity = identity(chooser.state())
            archive_hashes = lambda: {str(path):hashlib.sha256(path.read_bytes()).hexdigest() for path in chooser.state_root.rglob('*.jsonl')}
            before_archives = archive_hashes()
            chooser.send('\x1br');time.sleep(.1)
            opened = chooser.snapshot(f'chooser-{cols}-open')
            if CAPTURE:
                check('Request history' in opened and '> Current request' in opened,'chooser opens on Current at both sizes')
                check('History /' not in closed and 'HISTORY' not in closed,'closed history reserves no row or rail')
                check(any(row.startswith('+ CURRENT REQUEST') and row.endswith('+') and len(row)==cols for row in closed.splitlines()),'request frame spans body width')
            chooser.send('\x1b[<64;5;3M');wheel = chooser.snapshot(f'chooser-{cols}-wheel')
            if CAPTURE: check('> Request 1' in wheel,'wheel targets chooser without committing a request')
            chooser.send(f'\x1b[<65;5;{rows}M');outside = chooser.snapshot(f'chooser-{cols}-wheel-outside')
            if CAPTURE: check(stable_screen(outside)==stable_screen(wheel),'wheel outside chooser body leaves highlight alone')
            chooser.send('g');highlighted = chooser.snapshot(f'chooser-{cols}-highlight')
            if CAPTURE: check('> Request 1' in highlighted and 'Enter choose' in highlighted,'arrows only highlight and show choose action')
            chooser.send('h');chooser.wait(lambda:chooser.state().get('modal',{}).get('kind')=='help','help over chooser')
            chooser.send('\x1b');time.sleep(.1)
            if CAPTURE: check(stable_screen(chooser.snapshot(f'chooser-{cols}-help-restored'))==stable_screen(highlighted),'help restores chooser candidate and viewport')
            chooser.send('h');chooser.wait(lambda:chooser.state().get('modal',{}).get('kind')=='help','reopen help over chooser')
            chooser.send('\x03');chooser.wait(lambda:chooser.state().get('modal',{}).get('kind')=='none','idle Ctrl+C closes help first')
            if CAPTURE: check(stable_screen(chooser.snapshot(f'chooser-{cols}-help-ctrl-c'))==stable_screen(highlighted),'Ctrl+C help dismissal preserves chooser and draft')
            chooser.size(120 if cols==80 else 80,40 if cols==80 else 24)
            resized = chooser.snapshot(f'chooser-{cols}-resized')
            if CAPTURE: check('> Request 1' in resized and 'Request history' in resized,'resize keeps candidate and uniform chooser')
            chooser.size(cols,rows);time.sleep(.1)
            chooser.send('\x1b[200~');chooser.send('l\r\x1bOR\x03');chooser.send('\x1b[201~');time.sleep(.1)
            if CAPTURE: check('Request history' in chooser.snapshot(f'chooser-{cols}-paste'),'paste cannot select, cancel, or open models')
            chooser.send('\x03');dismissed = chooser.snapshot(f'chooser-{cols}-dismissed')
            if CAPTURE: check(stable_screen(dismissed)==stable_screen(closed),'idle Ctrl+C restores underlying view and draft cursor')
            chooser.send('\x1b[14~');chooser.send('g');chooser.send('\r');time.sleep(.1)
            selected = chooser.snapshot(f'chooser-{cols}-selected')
            if CAPTURE: check('HISTORY REQUEST 1' in selected and 'previous chooser request' in selected,'Enter displays selected historical request')
            chooser.send('\x1bOS');chooser.send('\x1b[F');chooser.send('\x1bOS');time.sleep(.1)
            if CAPTURE: check('HISTORY REQUEST 1' in chooser.snapshot(f'chooser-{cols}-f4-dismissed'),'End remains provisional and F4 dismisses')
            check(identity(chooser.state())==before_identity,'chooser preserves current request, pending plan and both session identities')
            check(archive_hashes()==before_archives,'chooser makes zero persisted archive writes')
            chooser.send('\x1b[1;1S');chooser.send('l');time.sleep(.1)
            live = chooser.snapshot(f'chooser-{cols}-live')
            if CAPTURE: check('CURRENT REQUEST 2' in live and 'Following' in live,'enhanced F4 and Current return to live output')
            chooser.send('\x1be');chooser.send('X\r')
            chooser.wait(lambda:any(entry.get('text')=='ab\ncXd' for entry in chooser.state().get('conversation',[])),'chooser preserves multiline draft insertion cursor')
            chooser.wait(lambda:chooser.state().get('operation',{}).get('kind')=='completed','post chooser submission')
            chooser.command('slow chooser cancellation')
            chooser.wait(lambda:bool(chooser.state().get('liveStream')),'streaming during chooser fixture')
            running_sessions = [(r['role'],r['sessionId']) for r in chooser.state()['status']['runtimes']]
            current_turn = chooser.state()['history']['currentTurnId']
            operator_count = len([entry for entry in chooser.state()['conversation'] if entry['kind']=='operator_message'])
            chooser.send('cancel draft');chooser.send('\x1bOS');chooser.send('g');chooser.send('\r')
            running_history = chooser.snapshot(f'chooser-{cols}-running-selected')
            if CAPTURE: check('HISTORY REQUEST 1' in running_history,'retained selection while live request runs')
            check(chooser.state()['operation']['kind']=='running' and chooser.state()['history']['currentTurnId']==current_turn,'history selection leaves running request ownership intact')
            check(len([entry for entry in chooser.state()['conversation'] if entry['kind']=='operator_message'])==operator_count,'running history navigation never submits another prompt')
            chooser.send('\x1bOS');chooser.send('\x1b[F');chooser.send('\x1bOS')
            if CAPTURE: check('HISTORY REQUEST 1' in chooser.snapshot(f'chooser-{cols}-running-dismissed'),'dismissal leaves displayed history during execution')
            chooser.send('\x1bOS');chooser.send('l');chooser.send('\x1be')
            chooser.send('\x1bOS');chooser.send('\x03')
            chooser.wait(lambda:chooser.state().get('operation',{}).get('kind')=='cancelled','Ctrl+C cancels while choosing')
            cancelled = chooser.snapshot(f'chooser-{cols}-cancelled')
            if CAPTURE: check('Request history' in cancelled and 'cancel draft' in cancelled and 'unread' in cancelled,'running cancellation preserves chooser, hidden draft and unread output')
            check([(r['role'],r['sessionId']) for r in chooser.state()['status']['runtimes']]==running_sessions,'running chooser never rebinds sessions')
            chooser.send('\x1bOS');chooser.send('\x03');chooser.command('/new')
            chooser.wait(lambda:not chooser.state()['history'].get('currentTurnId') and chooser.state().get('operation',{}).get('kind')=='idle' and chooser.state().get('notification',{}).get('code')=='conversation.created','both replacements completed for empty current conversation')
            if CAPTURE: chooser.wait(lambda:any('New conversation' in row for row in chooser.screen.display),'new conversation rendered before opening history')
            chooser.send('\x1bOS');empty = chooser.snapshot(f'chooser-{cols}-empty')
            if CAPTURE: check('> Current conversation' in empty and 'empty' in empty,'blank Current target remains selectable')
            chooser.send('\r');time.sleep(.1)
            if CAPTURE: check('New conversation' in chooser.snapshot(f'chooser-{cols}-empty-live'),'empty Current returns to live body')
            chooser.send('\x1be');chooser.stop()
        finally:
            if chooser.process.poll() is None: chooser.process.kill();chooser.process.wait()
    completion = Terminal(root,'history-completion',size=(80,24))
    try:
        completion.send('\x1bOQ')
        completion.send('\x1b[200~\none\ntwo\nthree\nfour\nfive\nsix\x1b[201~')
        for _ in range(6): completion.send('\x1b[A')
        completion.send('\x1b[H');completion.send('/')
        completion.wait(lambda:b'Show commands' in completion.output,'multiline editor completion visible')
        completion.send('\x1bOS');screen = completion.snapshot('chooser-completion-80x24')
        if CAPTURE:
            check('> Current conversation' in screen and 'Enter choose' in screen,'chooser remains usable after dismissing tall editor completion')
            check('six' in screen and ('Current /' in screen or 'Current activity' in screen),'multiline draft and activity remain mounted')
        completion.send('\x1bOS');completion.send('sta');time.sleep(.08);completion.send('\t')
        if CAPTURE: check('/status' in completion.snapshot('chooser-completion-restored-80x24'),'completion works again after history dismisses')
        check(not any(entry['kind']=='operator_message' for entry in completion.state()['conversation']),'completion and chooser never submit the multiline draft')
        completion.send('\x03');completion.stop()
    finally:
        if completion.process.poll() is None: completion.process.kill();completion.process.wait()
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
            if history_mode != 'plain' and CAPTURE:
                terminal.size(120,80)
                screen = terminal.snapshot('plan-paragraph-spacing-120x80')
                rows = screen.splitlines()
                parts = ['Proposed plan: Ready', 'Write result.txt', 'Verify content', 'Acceptance criteria:', 'result file verified']
                positions = [next(i for i, row in enumerate(rows) if part in row) for part in parts]
                check(all(right == left + 2 for left, right in zip(positions, positions[1:])), 'one blank row separates plan sections and steps')
                check(all(not rows[left + 1].strip(' |') for left in positions[:-1]), 'plan separators contain no text')
                check('•' in rows[positions[-1]] or '- result file verified' in rows[positions[-1]], 'acceptance criteria render as bullets')
                terminal.size(120,40)
            terminal.command('/approve')
            terminal.wait(lambda:any(record['kind']=='run' and record.get('role')=='B' and record['outcome']['kind']=='running' for record in terminal.state().get('history',{}).get('records',[])),'real B run')
            if history_mode != 'plain':
                terminal.wait(lambda:b'Current / B - Junior' in terminal.output,'B current activity identity')
                terminal.snapshot('B-execution-120x40',role='B')
                terminal.size(120,80)
                screen = terminal.snapshot('B-execution-120x80',role='B')
                if CAPTURE:
                    check('CURRENT REQUEST' in screen and 'HISTORY' not in screen and 'History /' not in screen,'full-width closed history layout')
                    check('Plan prose retained.' in screen,'planning narrative remains visible after B takes ownership')
                    check('[completed] read evidence.txt' not in screen,'executed tools start collapsed during execution')
                terminal.size(80,24);terminal.snapshot('B-execution-80x24',role='B')
            terminal.wait(lambda:any(record['kind']=='turn' and record.get('execution',{}).get('checkIn',{}).get('kind')=='checking' for record in terminal.state().get('history',{}).get('records',[])),'senior check-in at completed B turn 10')
            if history_mode != 'plain':
                screen = terminal.snapshot('A-check-in-80x24',role='A')
                if CAPTURE:
                    check('B turns: 10 successful / A checking turn 10' in screen,'visible count matches actual senior pause')
                    rows = screen.splitlines()
                    active = next(i for i, line in enumerate(rows) if 'Current / A - Senior' in line)
                    check(all(i < active for i, line in enumerate(rows) if '[completed]' in line),'active line follows completed tool records')
            terminal.wait(lambda:any(record['kind']=='run' and record.get('role')=='A' and record.get('phase')=='Review' and record['outcome']['kind']=='running' for record in terminal.state().get('history',{}).get('records',[])),'real A review run')
            if history_mode != 'plain':
                terminal.wait(lambda:b'Current / A - Senior' in terminal.output,'A current activity identity')
                terminal.size(120,40)
                terminal.snapshot('A-review-120x40',role='A')
                terminal.size(120,80)
                screen = terminal.snapshot('A-review-120x80',role='A')
                if CAPTURE:
                    check('checking the remaining evidence' in screen,'B narrative resumes after the A check-in')
                    check('collecting the requested history evidence' in screen,'senior check-in summary stays in the narrative')
                    check(screen.index('collecting the requested history evidence') < screen.index('checking the remaining evidence'),'B commentary follows the completed senior check-in')
                    check('tool call' in screen and '[completed] read evidence.txt' not in screen,'tool totals replace individual tool rows')
                terminal.size(120,40)
            terminal.wait(lambda:terminal.state().get('operation',{}).get('kind')=='completed','history stress complete')
            history = terminal.state()['history']; records = history['records']
            calls = [record for record in records if record['kind']=='tool']
            runs = [record for record in records if record['kind']=='run']
            check(b'\x1b[36;49m' in terminal.output and b'\x1b[33;49m' in terminal.output,'standard cyan and amber role styles reach the real TTY') if history_mode != 'plain' else None
            check(history['currentTurnId']==plan_turn,'approval retains originating operator turn')
            execution = next(record['execution'] for record in records if record['id']==plan_turn)
            check(execution['completedTurns']==12 and execution['checkIn']['kind']=='final_review','successful B turns exclude failed calls and A check-in, and include valid completion')
            check(len(calls)==12,'all twelve calls retained')
            check(len([call for call in calls if call['outcome']['kind']=='failed'])==1,'failed call retained')
            check([run['phase'] for run in runs if run['parentId']==plan_turn]==['Planning','Execution','Check-in','Review'],'individual planning execution check-in and review runs')
            check(all(record['outcome']['kind']!='running' for record in records),'no stale running records after completion')
            progress = next(run for run in runs if run['phase']=='Check-in')
            terminal.command('/inspect '+progress['id']+' output')
            terminal.wait(lambda:'Progress check after turn 10: Continue' in terminal.state().get('modal',{}).get('content',''),'readable check-in output')
            content = terminal.state()['modal']['content']
            check('schemaVersion' not in content and 'workflowId' not in content and 'pi-check-in' not in content,'check-in protocol hidden from ordinary output')
            check('collecting the requested history evidence' in content,'useful check-in reason retained')
            if history_mode != 'plain': terminal.send('\x1b');time.sleep(.08)
            terminal.command('/inspect '+progress['id']+' metadata')
            terminal.wait(lambda:'"checkIn"' in terminal.state().get('modal',{}).get('content',''),'explicit check-in metadata')
            check('schemaVersion' in terminal.state()['modal']['content'],'protocol fields available only on metadata inspection')
            if history_mode != 'plain': terminal.send('\x1b');time.sleep(.08)
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
                terminal.send('\x1b[H');terminal.send('\x1b[B');terminal.send('\x1b[C');terminal.send('\x1b[B');terminal.send('\r');time.sleep(.1)
                terminal.send('3');terminal.wait(lambda:b'safe retained line' in terminal.output,'tool inspector output');terminal.send('\x1b[F');terminal.wait(lambda:b'SAFE_TAIL' in terminal.output,'retained output tail')
                screen_before = terminal.snapshot('historical-tool-120x40')
                terminal.send('h')
                terminal.wait(lambda:terminal.state().get('modal',{}).get('kind')=='help','h help over inspector')
                terminal.snapshot('help-over-inspector-120x40')
                terminal.send('\x1b');time.sleep(.1)
                screen_after = terminal.snapshot('restored-inspector-120x40')
                if CAPTURE:
                    check(screen_after==screen_before,'help restores inspector selection scroll and draft')
                    check('SAFE_TAIL' in screen_after,'full retained tool tail reachable')
                    check('历史 é 😀 draft' in screen_after,'draft survives inspection and help')
                terminal.size(80,24)
                screen = terminal.snapshot('historical-tool-80x24')
                if CAPTURE: check('READ-ONLY INSPECTOR' in screen and 'Request completed' in screen,'narrow inspector keeps honest active pointer')
                terminal.send('\x1b');time.sleep(.1)
                for _ in range(4): terminal.send('\x1b[B')
                terminal.send('\r');time.sleep(.1);terminal.send('3')
                terminal.wait(lambda:b'Isolated tool failed' in terminal.output,'failed tool retained output')
                screen = terminal.snapshot('failed-tool-80x24')
                if CAPTURE: check('output / failed' in screen and 'Isolated tool failed' in screen,'failed output remains independently inspectable')
                terminal.send('\x1b');time.sleep(.1)
                terminal.send('\x1bOS');terminal.send('g');time.sleep(.1)
                screen = terminal.snapshot('history-list-80x24')
                if CAPTURE: check('Request history' in screen and '> Request 1' in screen and 'seed discussion' in screen,'uniform chooser highlights a previous request')
                terminal.send('\r');time.sleep(.1)
                screen = terminal.snapshot('history-selected-80x24')
                if CAPTURE: check('HISTORY REQUEST 1' in screen and 'New prompts use current conversation' in screen,'Enter displays historical request')
                terminal.send('\r');time.sleep(.1);terminal.send('3')
                terminal.read();time.sleep(.1);terminal.send('\x1b[F')
                screen = terminal.snapshot('previous-A-run-80x24')
                if CAPTURE: check('A - Senior / run' in screen and 'TERMINAL_DISCUSSION_OK' in screen,'past operator turn run prose independently inspectable')
                terminal.send('\x1b');time.sleep(.1)
                terminal.send('\x1b[14~');terminal.send('l');time.sleep(.1)
                terminal.send('\x1be');time.sleep(.1);terminal.read()
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
    activity = Terminal(root,'activity-narrative',size=(120,80))
    try:
        activity.command('/config timeout-ms 60000')
        activity.wait(lambda:activity.state().get('status',{}).get('timeoutMs')==60000,'budget for delayed multi-round activity fixture')
        activity.command('/config review-rounds 3')
        activity.wait(lambda:activity.state().get('status',{}).get('maxReviewRounds')==3,'activity review budget')
        # Allow capture overhead across fourteen native tool turns and a check-in.
        activity.command('/config timeout-ms 30000')
        activity.wait(lambda:activity.state().get('status',{}).get('timeoutMs')==30000,'activity capture workflow budget')
        activity.command('plan activity narrative')
        activity.wait(lambda:bool(activity.state().get('pendingPlan')),'activity plan ready')
        check(not (activity.workspace/'result.txt').exists(),'activity scenario requires explicit approval')
        activity.snapshot('activity-approval-120x80')
        activity.command('/approve')
        activity.wait(lambda:activity.state().get('currentActivity',{}).get('owner',{}).get('role')=='B','activity B owner')
        b_run = activity.state()['currentActivity']['owner']['runId']
        activity.send('next 界 😀 draft')
        activity.wait(lambda:'next 界 😀 draft' in '\n'.join(activity.screen.display) if CAPTURE else 'next 界 😀 draft'.encode() in activity.output,'next-message draft rendered before resize')
        for cols,rows in [(120,80),(120,40),(80,24),(40,12),(120,80)]:
            activity.size(cols,rows);time.sleep(.1)
            screen = activity.snapshot(f'activity-live-{cols}x{rows}')
            if CAPTURE:
                check(('Current /' in screen or 'Current activity' in screen) and 'draft' in screen,'live action and draft visible at target size')
                check('Ctrl+C cancel' in screen, 'cancellation remains visible alongside workflow notifications')
        activity.wait(lambda:activity.state().get('currentActivity',{}).get('phase')=='Check-in','activity A check-in')
        screen = activity.snapshot('activity-check-in-120x80',role='A')
        if CAPTURE:
            check('Current / A - Senior' in screen and 'A checking turn 10' in screen,'real check-in owns the activity panel')
            rows = screen.splitlines()
            recent = [i for i, row in enumerate(rows) if 'recent call' in row]
            check(len(recent) == 1, 'recent calls occupy a single summary row')
            check(not rows[recent[0]-1].strip('| '), 'a full blank row separates current activity from recent calls')
            clock = next(i for i, row in enumerate(rows) if 'last event' in row)
            check(activity.screen.buffer[clock][rows[clock].index('elapsed')].fg == 'white', 'activity timing uses secondary gray')
            check(activity.screen.buffer[recent[0]][rows[recent[0]].index('recent')].fg == 'cyan', 'recent calls use Agent A cyan during check-in')
        activity.wait(lambda:activity.state().get('currentActivity',{}).get('owner',{}).get('role')=='B','B continues after check-in')
        check(activity.state()['currentActivity']['owner']['runId']==b_run,'continued B activity retains original run identity')
        activity.wait(lambda:any('continuing after the senior check-in' in entry.get('text','') for entry in activity.state().get('conversation',[])),'continued B prose observed')
        screen = activity.snapshot('activity-continuation-120x80',role='B')
        if CAPTURE: check('Execution continued' in screen,'continuation is chronological rather than a new operator request')
        activity.wait(lambda:activity.state().get('currentActivity',{}).get('phase')=='Revision','B revision starts')
        activity.snapshot('activity-revision-120x80',role='B')
        activity.wait(lambda:activity.state().get('operation',{}).get('kind')=='completed','activity final approval')
        check((activity.workspace/'result.txt').read_text()=='revised','revision is a real sandboxed write')
        reviews = [record for record in activity.state()['history']['records'] if record['kind']=='run' and record.get('phase')=='Review']
        check([record.get('reviewDisposition') for record in reviews]==['revision_requested','approved'],'review decisions are separate from run settlement')
        final = activity.snapshot('activity-final-120x80')
        if CAPTURE: check('A approved the result' in final and 'Request completed' in final,'final approval and terminal outcome are rendered')
        activity.send('\x1bOS')
        activity.snapshot('activity-history-120x80')
        activity.send('\x1b')
        activity.send('\x1b');activity.send('h')
        activity.snapshot('activity-help-120x80')
        activity.send('\x1b')
        activity.stop(via_signal=True)
    finally:
        if activity.process.poll() is None: activity.process.kill();activity.process.wait()
    for reliability_mode in ['reliability', 'plain-reliability']:
        reliability = Terminal(root, reliability_mode, size=(120,40))
        try:
            test_text = "import test from 'node:test'; import assert from 'node:assert/strict'; test('ascending assertion',()=>assert.equal(1,2));\n"
            (reliability.workspace/'check.test.mjs').write_text(test_text)
            reliability.command('plan reliability fixture')
            reliability.wait(lambda:bool(reliability.state().get('pendingPlan')),'verification waits for operator approval')
            reliability.command('/approve')
            reliability.wait(lambda:reliability.state().get('operation',{}).get('kind')=='completed','accurate failed-check diagnostic completes')
            reliability.wait(lambda:b'TERMINAL_FAILED_CHECK' in reliability.output,'failed-check report rendered')
            if reliability_mode == 'reliability':
                screen = reliability.snapshot(reliability_mode+'-failed-check-120x40')
                if CAPTURE: check('one failed ascending assertion' in screen,'failed check remains visible after diagnostic approval')
            else:
                reliability.read()
                (EVIDENCE/'plain-reliability-failed-check.txt').write_text(reliability.output.decode('utf-8','replace'))
            calls = [record for record in reliability.state()['history']['records'] if record['kind']=='tool']
            check([call['toolName'] for call in calls]==['read','bash'],'printed markup never becomes an additional native call')
            check(calls[-1]['outcome']['kind']=='failed','failed native command remains failed in history')
            check((reliability.workspace/'check.test.mjs').read_text()==test_text,'failed verification does not repair the app')
            reliability.command('/inspect '+calls[-1]['id']+' output')
            reliability.wait(lambda:'Observed shell exit code: 1' in reliability.state().get('modal',{}).get('content',''),'read-only inspection shows native failed exit')
            if reliability_mode == 'reliability': reliability.snapshot(reliability_mode+'-native-history-120x40')
            else:
                reliability.wait(lambda:b'Observed shell exit code: 1' in reliability.output,'plain native exit rendered')
                (EVIDENCE/'plain-reliability-native-history.txt').write_text(reliability.output.decode('utf-8','replace'))
            log = (reliability.state_root/'logs'/'coordinator.jsonl').read_text()
            check(log.count('workflow.tool_recovery_redirected')==1,'one bounded printed-markup recovery retained')
            if reliability_mode == 'reliability': reliability.send('\x1b')
            reliability.stop(via_signal=True)
        finally:
            if reliability.process.poll() is None: reliability.process.kill();reliability.process.wait()
    verify_stream_failure(root)
    verify_cloud_stream_failure(root)
    for scenario in ['A', 'B', 'fail', 'cancel', 'plain']:
        compact = Terminal(root, 'plain-compaction' if scenario == 'plain' else 'compaction-' + scenario, (120,80))
        try:
            if scenario == 'B':
                compact.command('plan B compaction fixture')
                compact.wait(lambda:bool(compact.state().get('pendingPlan')),'compaction approval boundary')
                compact.command('/approve')
            else:
                compact.command(('fail ' if scenario == 'fail' else '') + 'compaction fixture')
            compact.wait(lambda:compact.state().get('currentActivity',{}).get('action',{}).get('kind')=='compaction','visible compaction pause')
            role = 'B' if scenario == 'B' else 'A'
            state = compact.state()
            check(state['currentActivity']['action']['role']==role,'compaction identifies affected history')
            if scenario != 'plain':
                screen = compact.snapshot('compaction-'+scenario+'-120x80')
                if CAPTURE: check("Agent A is compacting Agent " + role in screen,'compaction is obvious with diagnostics hidden')
                compact.size(40,12);time.sleep(.1)
                small = compact.snapshot('compaction-'+scenario+'-40x12')
                if CAPTURE: check('compact' in small.lower() and 'Ctrl+C' in small,'narrow compaction retains action and cancellation')
                compact.size(120,80)
            if scenario == 'cancel':
                compact.send('\x1bOS');time.sleep(.1)
                compact.snapshot('compaction-cancel-history-120x80')
                compact.send('\x03')
                compact.wait(lambda:compact.state().get('operation',{}).get('kind')=='cancelled','compaction cancel drains')
            else:
                expected = 'failed' if scenario == 'fail' else 'completed'
                compact.wait(lambda:compact.state().get('operation',{}).get('kind')==expected,'compaction terminal outcome')
            milestones = compact.state().get('history',{}).get('milestones',[])
            check(any(item.get('eventType')=='compaction.started' for item in milestones),'compaction start retained in history')
            terminal_event = 'cancelled' if scenario == 'cancel' else 'failed' if scenario == 'fail' else 'completed'
            check(any(item.get('eventType')=='compaction.'+terminal_event for item in milestones),'compaction outcome retained in history')
            if scenario == 'B': check((compact.workspace/'result.txt').read_text()=='compaction write preserved','compaction preserves completed B write')
            if scenario == 'plain':
                check(b'Agent A is compacting' in compact.output and b'history compacted by A' in compact.output,'plain compaction prints lifecycle')
            compact.stop(via_signal=True)
        finally:
            if compact.process.poll() is None: compact.process.kill();compact.process.wait()
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
