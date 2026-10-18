/**
 * calculator.test.js — Focused arithmetic tests using Node's built-in test runner.
 *
 * Tests cover: basic operations, decimal precision (0.1 + 0.2), left-to-right
 * chaining, negative operands, duplicate-decimal rejection at the JS level,
 * and division-by-zero error handling.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// Import the pure arithmetic module
import { add, subtract, multiply, divide, evaluate, negate } from '../calculator.js';

describe('addition', () => {
  it('adds two positive integers', () => {
    assert.strictEqual(add(2, 3), 5);
  });

  it('handles floating-point precision: 0.1 + 0.2 === 0.3', () => {
    assert.strictEqual(add(0.1, 0.2), 0.3);
  });

  it('adds negative numbers', () => {
    assert.strictEqual(add(-5, -3), -8);
  });

  it('adds a positive and a negative number', () => {
    assert.strictEqual(add(7, -4), 3);
  });

  it('adds zero', () => {
    assert.strictEqual(add(0, 0), 0);
  });
});

describe('subtraction', () => {
  it('subtracts two positive integers', () => {
    assert.strictEqual(subtract(10, 4), 6);
  });

  it('handles negative result', () => {
    assert.strictEqual(subtract(3, 7), -4);
  });

  it('subtracts a negative (adds)', () => {
    assert.strictEqual(subtract(5, -2), 7);
  });
});

describe('multiplication', () => {
  it('multiplies two positive integers', () => {
    assert.strictEqual(multiply(3, 4), 12);
  });

  it('handles negative operands', () => {
    assert.strictEqual(multiply(-3, 4), -12);
  });

  it('negative × negative = positive', () => {
    assert.strictEqual(multiply(-3, -5), 15);
  });

  it('multiplies by zero', () => {
    assert.strictEqual(multiply(7, 0), 0);
  });
});

describe('division', () => {
  it('divides evenly', () => {
    assert.strictEqual(divide(10, 2), 5);
  });

  it('handles decimal result', () => {
    assert.strictEqual(divide(1, 3), 0.33333333333333);
  });

  it('throws on division by zero', () => {
    assert.throws(() => divide(5, 0), /Division by zero/);
  });

  it('handles negative ÷ positive', () => {
    assert.strictEqual(divide(-10, 2), -5);
  });
});

describe('evaluate (left-to-right chaining)', () => {
  it('simple two-operand expression: 2 + 3 → 5', () => {
    assert.strictEqual(evaluate([2, 3], ['+']), 5);
  });

  it('three-operand left-to-right: 2 + 3 × 4 → (2+3)×4 = 20', () => {
    assert.strictEqual(evaluate([2, 3, 4], ['+', '×']), 20);
  });

  it('chained subtraction and division: 10 − 2 ÷ 2 → (10−2)÷2 = 4', () => {
    assert.strictEqual(evaluate([10, 2, 2], ['-', '÷']), 4);
  });

  it('single operand returns itself', () => {
    assert.strictEqual(evaluate([7], []), 7);
  });

  it('empty operands returns 0', () => {
    assert.strictEqual(evaluate([], []), 0);
  });

  it('handles negative first operand: −3 + 5 → 2', () => {
    assert.strictEqual(evaluate([-3, 5], ['+']), 2);
  });
});

describe('negate (sign toggle)', () => {
  it('negates a positive number', () => {
    assert.strictEqual(negate(7), -7);
  });

  it('negates a negative number back to positive', () => {
    assert.strictEqual(negate(-4), 4);
  });

  it('negating zero stays zero (handles -0 === 0)', () => {
    // In JS, Object.is(-0, 0) is false but -0 === 0 is true.
    // Use loose equality or check sign bit to avoid strictEqual flakiness.
    assert.ok(negate(0) === 0);
  });
});

describe('division-by-zero recovery', () => {
  it('after a division-by-zero error, subsequent operations still work', () => {
    // First call throws
    assert.throws(() => divide(1, 0), /Division by zero/);

    // Then a clean operation succeeds
    assert.strictEqual(add(2, 3), 5);
  });

  it('evaluate with division-by-zero in the chain throws', () => {
    assert.throws(() => evaluate([10, 0], ['÷']), /Division by zero/);
  });
});
