/**
 * app.js — DOM-facing calculator interface.
 * Handles mouse, touch, and keyboard input.
 * Uses calculator-state.mjs for all input/state transitions
 * and calculator.mjs for pure arithmetic evaluation.
 */

import { createCalculatorState } from './calculator-state.mjs';
import { evaluate, formatDisplay } from './calculator.mjs';

// ---- Shared state machine ----
const state = createCalculatorState();

// ---- DOM refs ----
const displayEl = document.getElementById('result');
const expressionEl = document.getElementById('expression');

function updateDisplay() {
  const snap = state.getSnapshot();
  displayEl.textContent = snap.currentInput;
  expressionEl.textContent = state.formatExpression(snap.expressionParts);
}

// ---- Input handlers (delegate to shared state, then evaluate if needed) ----

function handleNum(value) {
  state.handleNum(value);
  updateDisplay();
}

function handleDecimal() {
  state.handleDecimal();
  updateDisplay();
}

function handleNegate() {
  state.handleNegate();
  updateDisplay();
}

function handleOp(op) {
  state.handleOp(op);
  updateDisplay();
}

function handleEquals() {
  const result = state.handleEquals();

  if (result && result.nums !== undefined) {
    const evalResult = evaluate(result.nums, result.ops);

    if (evalResult.error) {
      displayEl.textContent = 'Error';
      expressionEl.textContent = '';
      state.completeError();
    } else {
      const formatted = formatDisplay(evalResult.result);
      displayEl.textContent = formatted;
      expressionEl.textContent = '';
      state.completeEvaluation(evalResult.result);
    }
  }

  updateDisplay();
}

function handleClear() {
  state.handleClear();
  updateDisplay();
}

function handleBackspace() {
  state.handleBackspace();
  updateDisplay();
}

// ---- Button click handler ----
document.querySelector('.buttons').addEventListener('click', (e) => {
  const btn = e.target.closest('.btn');
  if (!btn) return;

  const action = btn.dataset.action;
  const value = btn.dataset.value;

  switch (action) {
    case 'num': handleNum(value); break;
    case 'decimal': handleDecimal(); break;
    case 'negate': handleNegate(); break;
    case 'op': handleOp(value); break;
    case 'equals': handleEquals(); break;
    case 'clear': handleClear(); break;
    case 'backspace': handleBackspace(); break;
  }

  // Visual feedback
  btn.classList.add('active');
  setTimeout(() => btn.classList.remove('active'), 100);
});

// ---- Keyboard handler ----
document.addEventListener('keydown', (e) => {
  const key = e.key;

  if ((key >= '0' && key <= '9') || key === '.') {
    e.preventDefault();
    handleNum(key);
    flashButton(`[data-value="${key}"]`);
  } else if (['+', '-', '*', '/'].includes(key)) {
    e.preventDefault();
    handleOp(key);
    flashButton(`[data-value="${key}"]`);
  } else if (key === 'Enter' || key === '=') {
    e.preventDefault();
    handleEquals();
    flashButton('[data-action="equals"]');
  } else if (key === 'Escape') {
    e.preventDefault();
    handleClear();
    flashButton('[data-action="clear"]');
  } else if (key === 'Backspace') {
    e.preventDefault();
    handleBackspace();
    flashButton('[data-action="backspace"]');
  }
});

function flashButton(selector) {
  const btn = document.querySelector(selector);
  if (!btn) return;
  btn.classList.add('active');
  setTimeout(() => btn.classList.remove('active'), 100);
}

// ---- Init ----
updateDisplay();
