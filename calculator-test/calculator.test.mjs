/**
 * Calculator Module Tests
 * Runs in Node.js using built-in assert module.
 * Test all arithmetic operations, edge cases, and formatting.
 */

import { test } from 'node:test';
import assert from 'node:assert';
import {
  calculate,
  evaluateChain,
  formatResult,
  parseNumber
} from './calculator.mjs';
import { CalculatorState } from './calculator-state.mjs';

// Test suite for calculator module
test('Calculator Module Tests', async (t) => {
  // Format result tests
  await t.test('formatResult: handles integer', () => {
    assert.strictEqual(formatResult(5), '5');
    assert.strictEqual(formatResult(0), '0');
  });

  await t.test('formatResult: handles decimals', () => {
    assert.strictEqual(formatResult(0.5), '0.5');
  });

  await t.test('formatResult: fixes floating-point artifact (0.1 + 0.2)', () => {
    // This is the key test - should display as "0.3" not "0.30000000000000004"
    const result = 0.1 + 0.2;
    assert.strictEqual(formatResult(result), '0.3');
  });

  await t.test('formatResult: handles large numbers', () => {
    const large = 123456789;
    assert.strictEqual(formatResult(large), large.toString());
  });

  await t.test('formatResult: handles negative numbers', () => {
    assert.strictEqual(formatResult(-5.5), '-5.5');
  });

  // Addition tests
  await t.test('calculate: addition with integers', () => {
    assert.strictEqual(calculate(2, '+', 3), '5');
    assert.strictEqual(calculate(0, '+', 0), '0');
    assert.strictEqual(calculate(-5, '+', -3), '-8');
  });

  await t.test('calculate: addition with decimals', () => {
    assert.strictEqual(calculate(0.1, '+', 0.2), '0.3');
    assert.strictEqual(calculate(1.5, '+', 2.5), '4');
  });

  // Subtraction tests
  await t.test('calculate: subtraction with integers', () => {
    assert.strictEqual(calculate(5, '-', 3), '2');
    assert.strictEqual(calculate(3, '-', 5), '-2');
    assert.strictEqual(calculate(0, '-', 0), '0');
  });

  await t.test('calculate: subtraction with decimals', () => {
    assert.strictEqual(calculate(1.5, '-', 0.5), '1');
    assert.strictEqual(calculate(2.7, '-', 1.3), '1.4');
  });

  // Multiplication tests
  await t.test('calculate: multiplication with integers', () => {
    assert.strictEqual(calculate(4, '*', 5), '20');
    assert.strictEqual(calculate(0, '*', 100), '0');
    assert.strictEqual(calculate(-3, '*', -4), '12');
  });

  await t.test('calculate: multiplication with decimals', () => {
    assert.strictEqual(calculate(2.5, '*', 4), '10');
    assert.strictEqual(calculate(0.5, '*', 0.5), '0.25');
  });

  // Division tests
  await t.test('calculate: division with integers', () => {
    assert.strictEqual(calculate(10, '/', 2), '5');
    assert.strictEqual(calculate(7, '/', 2), '3.5');
  });

  await t.test('calculate: division with decimals', () => {
    assert.strictEqual(calculate(1.5, '/', 0.5), '3');
  });

  // Division by zero tests
  await t.test('calculate: division by zero throws error', () => {
    assert.throws(() => calculate(5, '/', 0), /Division by zero/);
    assert.throws(() => calculate(0, '/', 0), /Division by zero/);
  });

  // Invalid input tests
  await t.test('calculate: invalid operator throws error', () => {
    assert.throws(() => calculate(1, '%', 2), /Invalid operator/);
    assert.throws(() => calculate(1, '', 2), /Invalid operator/);
  });

  await t.test('calculate: non-finite operands throw error', () => {
    assert.throws(() => calculate(NaN, '+', 2), /Invalid operands/);
    assert.throws(() => calculate(1, '+', Infinity), /Invalid operands/);
  });

  // Left-to-right chaining tests
  await t.test('evaluateChain: basic chain (2 + 3) * 4 = 20', () => {
    const result = evaluateChain([2, 3, 4], ['+', '*']);
    assert.strictEqual(result, '20');
  });

  await t.test('evaluateChain: longer chain', () => {
    // (1 + 2) * 3 - 4 = 5
    const result = evaluateChain([1, 2, 3, 4], ['+', '*', '-']);
    assert.strictEqual(result, '5');
  });

  await t.test('evaluateChain: division chain', () => {
    // 100 / 2 / 5 = 10
    const result = evaluateChain([100, 2, 5], ['/', '/']);
    assert.strictEqual(result, '10');
  });

  await t.test('evaluateChain: division by zero in chain throws error', () => {
    // [10, 5, 0] with ['/', '/'] computes (10/5)/0 -> division by zero
    assert.throws(() => evaluateChain([10, 5, 0], ['/', '/']), /Division by zero/);
  });

  await t.test('evaluateChain: single number', () => {
    const result = evaluateChain([42], []);
    assert.strictEqual(result, '42');
  });

  // Chain validation tests
  await t.test('evaluateChain: invalid operators count throws error', () => {
    assert.throws(() => evaluateChain([1, 2, 3], ['+']), /Operators count/);
    assert.throws(() => evaluateChain([1], ['+', '-']), /Operators count/);
  });

  await t.test('evaluateChain: invalid input types throw error', () => {
    assert.throws(() => evaluateChain('not array', ['+']), /must be arrays/);
    assert.throws(() => evaluateChain([1], 'not array'), /must be arrays/);
  });

  // Negative number handling
  await t.test('calculate: negative number operations', () => {
    assert.strictEqual(calculate(-5, '+', 3), '-2');
    assert.strictEqual(calculate(10, '-', -5), '15');
    assert.strictEqual(calculate(-3, '*', -4), '12');
    assert.strictEqual(calculate(-10, '/', 2), '-5');
  });

  // Parse number tests
  await t.test('parseNumber: valid numbers', () => {
    assert.strictEqual(parseNumber('123'), 123);
    assert.strictEqual(parseNumber('-45.67'), -45.67);
    assert.strictEqual(parseNumber('0'), 0);
  });

  await t.test('parseNumber: invalid inputs return null', () => {
    assert.strictEqual(parseNumber(''), null);
    assert.strictEqual(parseNumber('-'), null);
    assert.strictEqual(parseNumber('abc'), null);
    // JS parses up to second dot as 12.34, but our validation requires finite
    // Number('12.34.56') returns NaN, so parseNumber returns null
    assert.strictEqual(parseNumber('12.34.56'), null);
  });

  // CalculatorState regression tests
  await t.test('CalculatorState: setError shows error message', () => {
    const state = new CalculatorState();
    state.setError('Division by zero is not allowed');
    assert.strictEqual(state.hasError, true);
    assert.strictEqual(state.currentInput, 'Division by zero is not allowed');
    assert.strictEqual(state.errorMessage, 'Division by zero is not allowed');
    // Pending state should be cleared
    assert.strictEqual(state.previousValue, null);
    assert.strictEqual(state.pendingOperator, null);
  });

  await t.test('CalculatorState: clear resets all state including error', () => {
    const state = new CalculatorState();
    state.setError('Division by zero is not allowed');
    state.clear();
    assert.strictEqual(state.hasError, false);
    assert.strictEqual(state.errorMessage, '');
    assert.strictEqual(state.currentInput, '0');
    assert.strictEqual(state.previousValue, null);
    assert.strictEqual(state.pendingOperator, null);
  });

  await t.test('CalculatorState: appendDigit starts new calculation after error', () => {
    const state = new CalculatorState();
    state.setError('Division by zero is not allowed');
    state.appendDigit('5');
    assert.strictEqual(state.hasError, false);
    assert.strictEqual(state.currentInput, '5');
  });

  await t.test('CalculatorState: appendDecimal starts new calculation after error', () => {
    const state = new CalculatorState();
    state.setError('Division by zero is not allowed');
    state.appendDecimal();
    assert.strictEqual(state.hasError, false);
    assert.strictEqual(state.currentInput, '0.');
  });

  await t.test('CalculatorState: setOperator throws on intermediate division by zero', () => {
    const state = new CalculatorState();
    state.previousValue = '5';
    state.pendingOperator = '/';
    state.currentInput = '0';
    const result = state.setOperator('+');
    assert.strictEqual(result, false);
    assert.strictEqual(state.hasError, true);
  });

  await t.test('CalculatorState: evaluate clears pending state on success', () => {
    const state = new CalculatorState();
    state.previousValue = '5';
    state.pendingOperator = '+';
    state.currentInput = '3';
    const result = state.evaluate();
    assert.strictEqual(result, '8');
    assert.strictEqual(state.previousValue, null);
    assert.strictEqual(state.pendingOperator, null);
  });

  await t.test('CalculatorState: evaluate sets error on division by zero', () => {
    const state = new CalculatorState();
    state.previousValue = '5';
    state.pendingOperator = '/';
    state.currentInput = '0';
    const result = state.evaluate();
    assert.strictEqual(result, null);
    assert.strictEqual(state.hasError, true);
    assert.strictEqual(state.errorMessage, 'Division by zero is not allowed');
  });

  await t.test('CalculatorState: backspace clears error state', () => {
    const state = new CalculatorState();
    state.setError('Division by zero is not allowed');
    state.backspace();
    assert.strictEqual(state.hasError, false);
    assert.strictEqual(state.currentInput, '0');
  });

  await t.test('CalculatorState: resetForNewInput clears error', () => {
    const state = new CalculatorState();
    state.setError('Division by zero is not allowed');
    state.resetForNewInput();
    assert.strictEqual(state.hasError, false);
    assert.strictEqual(state.currentInput, '0');
  });
});

console.log('All tests completed!');
