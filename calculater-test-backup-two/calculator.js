/**
 * calculator.js — Pure arithmetic engine (no DOM, no eval).
 *
 * Supports +, −, ×, ÷ with left-to-right chaining, decimal precision,
 * negative numbers via a sign-toggle helper, and explicit division-by-zero.
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Round to avoid floating-point noise up to 14 significant digits. */
function roundResult(value) {
  if (!isFinite(value)) return value;
  const factor = 1e14;
  return Math.round(value * factor) / factor;
}

/** Check whether a numeric string already contains a decimal point. */
function hasDecimal(str) {
  return typeof str === 'string' && str.includes('.');
}

// ---------------------------------------------------------------------------
// Core operations
// ---------------------------------------------------------------------------

export function add(a, b) {
  return roundResult(a + b);
}

export function subtract(a, b) {
  return roundResult(a - b);
}

export function multiply(a, b) {
  return roundResult(a * b);
}

/**
 * Division that throws on zero divisor so the caller can surface a
 * recoverable error message.
 */
export function divide(a, b) {
  if (b === 0) {
    throw new Error('Division by zero');
  }
  return roundResult(a / b);
}

// ---------------------------------------------------------------------------
// Chained evaluation (left-to-right)
// ---------------------------------------------------------------------------

/**
 * Evaluate a sequence of operands and operators left-to-right.
 *
 * @param {number[]} operands — e.g. [2, 3, 4]
 * @param {string[]} ops     — e.g. ['+', '*']   (length = operands.length - 1)
 * @returns {number} result of the chained evaluation
 */
export function evaluate(operands, ops) {
  if (operands.length === 0) return 0;
  let result = operands[0];
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];
    const next = operands[i + 1];
    switch (op) {
      case '+':  result = add(result, next); break;
      case '-':  result = subtract(result, next); break;
      case '×':  result = multiply(result, next); break;
      case '÷':  result = divide(result, next); break;
      default:   throw new Error(`Unknown operator: ${op}`);
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Sign toggle
// ---------------------------------------------------------------------------

/** Return the negation of a number (or NaN → NaN). */
export function negate(value) {
  if (!isFinite(value)) return value;
  return -value;
}
