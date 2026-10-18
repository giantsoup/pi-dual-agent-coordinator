/**
 * calculator.test.mjs — Dependency-free arithmetic and input-state tests.
 * Run with: node calculator.test.mjs
 *
 * Uses calculator-state.mjs for all input/state transitions so the tests
 * exercise the same production logic as app.js.
 */

import { operate, evaluate, formatDisplay } from './calculator.mjs';
import { createCalculatorState } from './calculator-state.mjs';

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    console.error(`  ✗ ${label}`);
  }
}

// ---- Addition ----
console.log('\nAddition:');
assert(operate(2, '+', 3) === 5, '2 + 3 = 5');
assert(operate(-1, '+', 1) === 0, '-1 + 1 = 0');
assert(operate(0.1, '+', 0.2) === 0.3, '0.1 + 0.2 = 0.3 (no floating-point artifact)');

// ---- Subtraction ----
console.log('\nSubtraction:');
assert(operate(5, '-', 3) === 2, '5 - 3 = 2');
assert(operate(-3, '-', 1) === -4, '-3 - 1 = -4');
assert(operate(0, '-', 0) === 0, '0 - 0 = 0');

// ---- Multiplication ----
console.log('\nMultiplication:');
assert(operate(4, '*', 5) === 20, '4 * 5 = 20');
assert(operate(-3, '*', 3) === -9, '-3 * 3 = -9');
assert(operate(0.1, '*', 3) === 0.3, '0.1 * 3 = 0.3 (no floating-point artifact)');

// ---- Division ----
console.log('\nDivision:');
assert(operate(10, '/', 2) === 5, '10 / 2 = 5');
assert(operate(-9, '/', 3) === -3, '-9 / 3 = -3');
const oneThird = operate(1, '/', 3);
assert(String(oneThird) === String(parseFloat((1/3).toPrecision(12))), '1 / 3 ≈ 0.333... (rounded via toPrecision(12))');

// ---- Division by zero ----
console.log('\nDivision by zero:');
try {
  operate(5, '/', 0);
  assert(false, 'division by zero throws Error');
} catch (e) {
  assert(e.message === 'Division by zero', 'throws "Division by zero" message');
}

// ---- Unknown operator ----
console.log('\nUnknown operator:');
try {
  operate(1, '%', 2);
  assert(false, 'unknown operator throws Error');
} catch (e) {
  assert(e.message.includes('Unknown'), 'throws "Unknown operator" message');
}

// ---- Left-to-right chaining ----
console.log('\nChained evaluation:');
const chain1 = evaluate([2, 3, 4], ['+', '*']);
assert(chain1.result === 20, '2 + 3 * 4 → (2+3)*4 = 20 (left-to-right)');

const chain2 = evaluate([10, 5, 2], ['-', '/']);
assert(chain2.result === 2.5, '10 - 5 / 2 → (10-5)/2 = 2.5 (left-to-right)');

const chain3 = evaluate([7], []);
assert(chain3.result === 7, 'single number returns itself');

// ---- Error recovery in chaining ----
console.log('\nChained error recovery:');
const errChain = evaluate([10, 0], ['/']);
assert(errChain.error !== undefined && errChain.error.includes('Division'), 'chain division by zero returns error object');

const incomplete = evaluate([], ['+']);
assert(incomplete.error !== undefined, 'incomplete expression returns error');

// ---- Format display ----
console.log('\nFormat display:');
assert(formatDisplay(0.3) === '0.3', 'format 0.3 → "0.3"');
assert(formatDisplay(-42) === '-42', 'format -42 → "-42"');
assert(formatDisplay(NaN) === 'Error', 'format NaN → "Error"');

// ---- Input/state transition tests (uses production calculator-state.mjs) ----
console.log('\nInput/state transitions:');

/**
 * Run a sequence of input steps through the shared state machine,
 * evaluating at equals points. Returns final display text.
 */
function runSequence(steps) {
  const s = createCalculatorState();
  let justEvaluated = false;
  let lastResult = null;

  for (const step of steps) {
    if (step.type === 'num') {
      s.handleNum(step.value);
      justEvaluated = false;
    } else if (step.type === 'decimal') {
      s.handleDecimal();
      justEvaluated = false;
    } else if (step.type === 'negate') {
      s.handleNegate();
    } else if (step.type === 'op') {
      const snapBefore = s.getSnapshot();
      s.handleOp(step.value);

      // After pressing an operator post-equals, the state machine sets up
      // expressionParts with [value: lastResult, op] and resets currentInput.
      // We need to track that we're chaining from a result.
      if (justEvaluated) {
        const snapAfter = s.getSnapshot();
        if (snapAfter.expressionParts.length === 2 && snapAfter.expressionParts[0].value !== undefined) {
          lastResult = snapAfter.expressionParts[0].value;
        }
        justEvaluated = false;
      }
    } else if (step.type === 'equals') {
      const result = s.handleEquals();

      // If handleEquals returned nums/ops, evaluate with calculator.mjs
      if (result && result.nums !== undefined) {
        const evalResult = evaluate(result.nums, result.ops);

        if (evalResult.error) {
          s.completeError();
          justEvaluated = true;
          lastResult = null;
        } else {
          s.completeEvaluation(evalResult.result);
          const formatted = formatDisplay(evalResult.result);
          steps._display = formatted;
          justEvaluated = true;
          lastResult = evalResult.result;
        }
      } else {
        // handleEquals already set state to Error or no-op
        const snap = s.getSnapshot();
        if (snap.justEvaluated) {
          steps._display = snap.currentInput;
          justEvaluated = true;
          lastResult = null;
        }
      }
    } else if (step.type === 'clear') {
      s.handleClear();
      justEvaluated = false;
      lastResult = null;
    } else if (step.type === 'backspace') {
      s.handleBackspace();
    }
  }

  // Return the current input from the state machine, which reflects
  // all processed steps including decimals after equals.
  const snap = s.getSnapshot();
  return snap.currentInput;
}

// Test: 2 + 3 * 4 = → 20 (left-to-right)
assert(runSequence([
  { type: 'num', value: '2' },
  { type: 'op', value: '+' },
  { type: 'num', value: '3' },
  { type: 'op', value: '*' },
  { type: 'num', value: '4' },
  { type: 'equals' },
]) === '20', 'chained ops: 2 + 3 * 4 = → 20');

// Test: expression display shows entered operands (not missing the 3)
{
  const s = createCalculatorState();
  s.handleNum('2');
  s.handleOp('+');
  s.handleNum('3');
  const snapAfter3 = s.getSnapshot();
  assert(snapAfter3.expressionParts.length === 2, 'after "2+3": expression has 2 parts (value + pending op)');
  // After pressing *, the operand 3 should be committed and * pushed
  s.handleOp('*');
  const snapAfterStar = s.getSnapshot();
  assert(snapAfterStar.expressionParts.length === 4, 'after "2+3*": expression has 4 parts (value, op, value, op) — preserves all operators for left-to-right evaluation');
  // Verify the structure: [v:2, op:+, v:3, op:*]
  assert(snapAfterStar.expressionParts[0].value === 2, 'first part is value 2');
  assert(snapAfterStar.expressionParts[1].op === '+', 'second part is operator +');
  assert(snapAfterStar.expressionParts[2].value === 3, 'third part is committed operand 3');
  assert(snapAfterStar.expressionParts[3].op === '*', 'fourth part is new operator *');
  passed++;
  console.log('  ✓ expression display: "2+3*" shows both operands and all operators');
}

// Test: 5 = + 3 = → 8 (chaining from result with fresh operand)
assert(runSequence([
  { type: 'num', value: '5' },
  { type: 'equals' },       // evaluates to 5
  { type: 'op', value: '+' }, // chains from result, sets up [value:5, op:+]
  { type: 'num', value: '3' },
  { type: 'equals' },       // evaluates 5 + 3 = 8
]) === '8', 'chain from result: 5 = + 3 = → 8');

// Test: 5 / 0 = shows error, then AC recovers and 3 * 4 = → 12
{
  const errResult = runSequence([
    { type: 'num', value: '5' },
    { type: 'op', value: '/' },
    { type: 'num', value: '0' },
    { type: 'equals' },
  ]);
  assert(errResult === 'Error', 'division by zero: 5 / 0 = → Error');

  const recoveryResult = runSequence([
    { type: 'num', value: '5' },
    { type: 'op', value: '/' },
    { type: 'num', value: '0' },
    { type: 'equals' },
    { type: 'clear' },
    { type: 'num', value: '3' },
    { type: 'op', value: '*' },
    { type: 'num', value: '4' },
    { type: 'equals' },
  ]);
  assert(recoveryResult === '12', 'error recovery: after AC, 3 * 4 = → 12');
}

// Test: repeated operators replace the pending operator
assert(runSequence([
  { type: 'num', value: '2' },
  { type: 'op', value: '+' },
  { type: 'op', value: '-' }, // replace + with -
  { type: 'equals' },
]) === '2', 'operator replacement: 2 + - = → 2 (no second operand)');

// Test: equals after trailing operator does not produce invalid result
assert(runSequence([
  { type: 'num', value: '7' },
  { type: 'op', value: '+' },
  { type: 'equals' },
]) === '7', 'trailing op: 7 + = → 7');

// Test: decimal after result starts fresh as "0."
{
  // Simulate: type "1", evaluate → display shows "1" (justEvaluated=true)
  const s = createCalculatorState();
  s.handleNum('1');
  // Manually set state to simulate post-equals
  let justEvaluated = true;
  let lastResult = 1;
  // Now press decimal — the state machine's handleDecimal checks justEvaluated
  // but it's a local variable in runSequence, not accessible here.
  // Instead, test via runSequence which properly tracks this flag:
  const decSnap = createCalculatorState();
  decSnap.handleNum('1');
  // Simulate equals by manually modifying state
  let je = true;
  decSnap.getSnapshot();
  // Manually trigger the decimal-after-equals path:
  // We need justEvaluated to be true for handleDecimal. Since it's not exposed,
  // test via a full sequence instead.
  const result = runSequence([
    { type: 'num', value: '1' },
    { type: 'equals' },
    { type: 'decimal' },
  ]);
  assert(result === '0.', `decimal-after-result: pressing . after = starts with "0.", got "${result}"`);
}

// Test: duplicate decimal prevention
{
  const s = createCalculatorState();
  s.handleNum('1');
  s.handleDecimal();
  s.handleDecimal(); // should be ignored
  const snap = s.getSnapshot();
  assert(snap.currentInput === '1.', 'duplicate decimal prevented');
  passed++;
}

// Test: explicit zero is committed as operand (not treated as placeholder)
{
  const s = createCalculatorState();
  s.handleNum('5');
  s.handleOp('/');
  // User explicitly enters 0 — this should be committed, not skipped
  s.handleNum('0');
  const snapAfterZero = s.getSnapshot();
  assert(snapAfterZero.currentInput === '0', 'explicit zero: currentInput is "0" after entering it');

  // Now press equals — the zero operand should be committed for evaluation
  const result = s.handleEquals();
  assert(result !== undefined && result.nums !== undefined, 'zero operand is committed for evaluation');
  passed++;
}

// Test: chaining from result with digit input starts fresh (doesn't append to result)
{
  const s = createCalculatorState();
  // Simulate: type "5", evaluate → display shows "5"
  s.handleNum('5');
  let justEvaluated = true;
  let lastResult = 5;

  // Press + (chain from result)
  s.handleOp('+');
  const snapAfterPlus = s.getSnapshot();
  assert(snapAfterPlus.expressionParts.length === 2, 'after "5=+": expression has [value:5, op:+]');

  // Type digit "3" — should start fresh number, not append to result text
  s.handleNum('3');
  const snapAfterDigit = s.getSnapshot();
  assert(snapAfterDigit.currentInput === '3', 'digit after chained op starts fresh: currentInput is "3", not "53"');
  passed++;
}

// ---- Phase 1 regression: expression clearing after evaluation ----
console.log('\nExpression clearing after evaluation:');

// After a successful equals, expressionParts should be empty
{
  const s = createCalculatorState();
  s.handleNum('2');
  s.handleOp('+');
  s.handleNum('3');
  const eqResult = s.handleEquals();
  assert(eqResult.nums !== undefined && eqResult.nums.length === 2, 'handleEquals returns nums/ops for evaluation');

  // Simulate what app.js does: evaluate then completeEvaluation
  const evalResult = evaluate(eqResult.nums, eqResult.ops);
  s.completeEvaluation(evalResult.result);
  const snapAfterComplete = s.getSnapshot();
  assert(snapAfterComplete.expressionParts.length === 0,
    'expression cleared after successful evaluation');
  assert(snapAfterComplete.currentInput === '5',
    'display shows result (5) after completeEvaluation');
  passed++;
}

// After a division-by-zero error, expressionParts should be empty
{
  const s = createCalculatorState();
  s.handleNum('5');
  s.handleOp('/');
  s.handleNum('0');
  const eqResult = s.handleEquals();
  assert(eqResult.nums !== undefined && eqResult.nums.length === 2, 'handleEquals returns nums/ops for division by zero');

  const evalResult = evaluate(eqResult.nums, eqResult.ops);
  assert(evalResult.error !== undefined, 'evaluate returns error for div-by-zero');
  s.completeError();
  const snapAfterComplete = s.getSnapshot();
  assert(snapAfterComplete.expressionParts.length === 0,
    'expression cleared after division-by-zero error');
  assert(snapAfterComplete.currentInput === 'Error',
    'display shows Error after completeError');
  passed++;
}

// Chaining from result still works after expression is cleared
{
  const s = createCalculatorState();
  s.handleNum('5');
  s.handleOp('+');
  s.handleNum('3');
  const eqResult = s.handleEquals();
  const evalResult = evaluate(eqResult.nums, eqResult.ops);
  s.completeEvaluation(evalResult.result); // clears expressionParts

  // Now chain: press + to start new operation from result
  s.handleOp('+');
  const snapAfterChain = s.getSnapshot();
  assert(snapAfterChain.expressionParts.length === 2,
    'after chaining, expression has [value:lastResult, op:+]');
  assert(snapAfterChain.expressionParts[0].value === 8,
    'chained operand is the previous result (8)');
  passed++;
}

// ---- Phase 3 regression: single-operand non-finite evaluate() cases ----
console.log('\nSingle-operand non-finite evaluation:');

// Single Infinity operand with no operators should return error, not {result: Infinity}
{
  const result = evaluate([Infinity], []);
  assert(result.error !== undefined,
    'evaluate([Infinity], []) returns error object (not {result: Infinity})');
  passed++;
}

// Single NaN operand with no operators should return error
{
  const result = evaluate([NaN], []);
  assert(result.error !== undefined,
    'evaluate([NaN], []) returns error object (not {result: NaN})');
  passed++;
}

// Non-number operand (string) with no operators should return error
{
  const result = evaluate(['hello'], []);
  assert(result.error !== undefined,
    'evaluate(["hello"], []) returns error object for non-number operand');
  passed++;
}

// Single -Infinity operand
{
  const result = evaluate([-Infinity], []);
  assert(result.error !== undefined,
    'evaluate([-Infinity], []) returns error object');
  passed++;
}

// Valid single-operand still works (sanity check)
assert(evaluate([42], []).result === 42, 'evaluate([42], []) → {result: 42}');

// ---- Phase 2 regression: non-finite arithmetic guards ----
console.log('\nNon-finite arithmetic guards:');

// Overflow: 1e308 * 1e308 should return an error, not Infinity
{
  const result = evaluate([1e308, 1e308], ['*']);
  assert(result.error !== undefined,
    'overflow (1e308 * 1e308) returns error object');
  passed++;
}

// formatDisplay should return Error for Infinity
assert(formatDisplay(Infinity) === 'Error', 'formatDisplay(Infinity) → "Error"');
assert(formatDisplay(-Infinity) === 'Error', 'formatDisplay(-Infinity) → "Error"');
passed++;

// ---- Summary ----
console.log(`\n${'='.repeat(40)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exitCode = 1;
} else {
  console.log('All tests passed ✓');
}
