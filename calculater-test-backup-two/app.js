/**
 * app.js — DOM wiring for the calculator.
 *
 * Reads button clicks and keyboard events, builds operand/operator queues,
 * calls into `calculator.js`, and updates the display.  No arithmetic logic
 * lives here; it delegates to the pure module.
 */

import { add, subtract, multiply, divide, evaluate, negate } from './calculator.js';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let currentInput = '0';   // text currently being typed on the display
let operands = [];        // numbers accumulated so far
let operators = [];       // pending operators (left-to-right)
let justEvaluated = false; // flag: next digit starts a fresh operand
let errorState = false;    // division-by-zero or other recoverable error

// ---------------------------------------------------------------------------
// DOM references
// ---------------------------------------------------------------------------

const displayEl = document.getElementById('display');
const buttons = document.querySelectorAll('.calc-btn');

// ---------------------------------------------------------------------------
// Display update
// ---------------------------------------------------------------------------

function render() {
  if (errorState) return;
  displayEl.textContent = currentInput;
}

function showError(msg) {
  errorState = true;
  displayEl.textContent = msg;
}

function clearError() {
  errorState = false;
}

// ---------------------------------------------------------------------------
// Input handling
// ---------------------------------------------------------------------------

/** Append a digit (0-9) to the current input. */
function inputDigit(digit) {
  if (errorState) return;
  clearError();
  if (justEvaluated) {
    // Starting fresh after an evaluation
    operands = [];
    operators = [];
    justEvaluated = false;
  }
  if (currentInput === '0' && digit !== '.') {
    currentInput = digit;
  } else if (digit === '.' && hasDecimal(currentInput)) {
    // Ignore duplicate decimal point
    return;
  } else {
    currentInput += digit;
  }
  render();
}

/** Toggle the sign of the current input. */
function toggleSign() {
  if (errorState) return;
  clearError();
  const num = parseFloat(currentInput);
  if (!isNaN(num)) {
    currentInput = String(-num);
    render();
  }
}

/** Process an operator button press (+, −, ×, ÷). */
function inputOperator(op) {
  if (errorState) return;
  clearError();
  const num = parseFloat(currentInput);
  if (isNaN(num)) return;

  operands.push(num);
  operators.push(op);
  justEvaluated = false;
  currentInput = '0';
  render();
}

/** Evaluate the pending expression left-to-right. */
function evaluateExpression() {
  if (errorState) return;
  clearError();

  const num = parseFloat(currentInput);
  if (!isNaN(num)) operands.push(num);

  if (operands.length === 0) return;

  try {
    const result = evaluate(operands, operators);
    currentInput = String(result);
    operands = [];
    operators = [];
    justEvaluated = true;
    render();
  } catch (e) {
    showError(e.message || 'Error');
  }
}

/** Clear everything back to initial state. */
function clearAll() {
  currentInput = '0';
  operands = [];
  operators = [];
  justEvaluated = false;
  errorState = false;
  render();
}

/** Delete the last character of the current input (backspace). */
function backspace() {
  if (errorState) return;
  clearError();
  if (justEvaluated) {
    // If we just evaluated, backspace acts like clear
    clearAll();
    return;
  }
  if (currentInput.length > 1) {
    currentInput = currentInput.slice(0, -1);
  } else {
    currentInput = '0';
  }
  render();
}

// ---------------------------------------------------------------------------
// Utility: check for decimal in a string
// ---------------------------------------------------------------------------

function hasDecimal(str) {
  return typeof str === 'string' && str.includes('.');
}

// ---------------------------------------------------------------------------
// Button click delegation
// ---------------------------------------------------------------------------

buttons.forEach((btn) => {
  btn.addEventListener('click', () => {
    const action = btn.dataset.action;
    switch (action) {
      case 'digit':   inputDigit(btn.dataset.value); break;
      case 'decimal': inputDigit('.'); break;
      case 'operator': inputOperator(btn.dataset.op); break;
      case 'equals':  evaluateExpression(); break;
      case 'clear':   clearAll(); break;
      case 'backspace': backspace(); break;
      case 'sign':    toggleSign(); break;
    }
  });
});

// ---------------------------------------------------------------------------
// Keyboard support
// ---------------------------------------------------------------------------

document.addEventListener('keydown', (e) => {
  const key = e.key;

  // Digits and decimal
  if (/^[0-9]$/.test(key)) {
    inputDigit(key);
    return;
  }
  if (key === '.') {
    inputDigit('.');
    return;
  }

  // Operators
  const opMap = { '+': '+', '-': '-', '*': '×', '/': '÷' };
  if (opMap[key]) {
    inputOperator(opMap[key]);
    return;
  }

  // Enter / Return → evaluate
  if (key === 'Enter' || key === '=') {
    e.preventDefault();
    evaluateExpression();
    return;
  }

  // Escape → clear
  if (key === 'Escape') {
    clearAll();
    return;
  }

  // Backspace → delete last char
  if (key === 'Backspace') {
    e.preventDefault();
    backspace();
    return;
  }
});

// Initial render
render();
