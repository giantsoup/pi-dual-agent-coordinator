/**
 * calculator-state.mjs — Shared input/state-transition logic.
 * Used by both app.js (UI) and calculator.test.mjs (Node tests).
 * Tracks whether an operand has been entered separately from its displayed value,
 * so that an explicitly-entered zero is not mistaken for a placeholder.
 */

export function createCalculatorState() {
  // ---- Core state ----
  let currentInput = '0';       // what the user is currently typing (display text)
  let expressionParts = [];     // [{value: number}, {op: string}, ...]
  let lastResult = null;        // cached result after '='
  let justEvaluated = false;    // flag to reset on new digit after '='

  // ---- Whether the user has actually typed a new operand since the last operator/equals ----
  let operandEntered = false;

  /** Check if current input string represents a valid finite number. */
  function isValidNumber(str) {
    if (str === '' || str === '-' || str === '.') return false;
    const n = parseFloat(str);
    return !isNaN(n) && isFinite(n);
  }

  /** Split currentInput into integer/decimal parts for duplicate-decimal prevention. */
  function splitCurrentNumber() {
    const parts = currentInput.split('.');
    return {
      integerPart: parts[0] || '',
      decimalPart: parts[1] || '',
      decimalUsed: parts.length > 1,
    };
  }

  /** Commit the current input as a number into expressionParts, then push an operator. */
  function commitOperandAndPushOp(op) {
    if (isValidNumber(currentInput)) {
      expressionParts.push({ value: parseFloat(currentInput) });
    } else {
      // Invalid input — treat as 0 to avoid NaN propagation
      expressionParts.push({ value: 0 });
    }
    expressionParts.push({ op });
    currentInput = '0';
    operandEntered = false;
  }

  /** Start a fresh entry after '='. If the key is '.', begin with "0." so it's valid. */
  function startFreshAfterEquals(key) {
    justEvaluated = false;
    expressionParts = [];
    lastResult = null;
    operandEntered = true;
    if (key === '.') {
      currentInput = '0.';
    } else {
      currentInput = key;
    }
  }

  // ---- Input handlers ----

  /** Handle digit input. */
  function handleNum(value) {
    if (justEvaluated) {
      startFreshAfterEquals(value);
    } else if (currentInput === '0' && value !== '.') {
      currentInput = value;
      operandEntered = true;
    } else {
      // Prevent multiple decimals in the same number segment
      const segments = splitCurrentNumber();
      if (value === '.' && segments.decimalUsed) return;
      currentInput += value;
      operandEntered = true;
    }

    return getSnapshot();
  }

  /** Handle decimal point input. */
  function handleDecimal() {
    if (justEvaluated) {
      startFreshAfterEquals('.');
    } else if (currentInput === '0') {
      currentInput = '0.';
      operandEntered = true;
    } else {
      const segments = splitCurrentNumber();
      if (segments.decimalUsed) return; // prevent double decimal
      currentInput += '.';
      operandEntered = true;
    }

    return getSnapshot();
  }

  /** Handle negate toggle. */
  function handleNegate() {
    if (currentInput === '0' || currentInput === '' || currentInput === '-') return;
    if (currentInput.startsWith('-')) {
      currentInput = currentInput.slice(1);
    } else {
      currentInput = '-' + currentInput;
    }
    operandEntered = true;

    return getSnapshot();
  }

  /** Handle operator input. */
  function handleOp(op) {
    if (justEvaluated && lastResult !== null) {
      // Chain from previous result: use the result as first operand, push new operator.
      // Reset currentInput to '0' so subsequent digits start a fresh number.
      expressionParts = [{ value: lastResult }, { op }];
      currentInput = '0';
      justEvaluated = false;
      operandEntered = false; // next digit entry will start fresh via handleNum
    } else if (expressionParts.length === 0 ||
               (expressionParts.length === 1 && !justEvaluated)) {
      // First number + operator
      const num = isValidNumber(currentInput) ? parseFloat(currentInput) : 0;
      expressionParts.push({ value: num }, { op });
      currentInput = '0';
      operandEntered = false;
    } else {
      // There are already parts — handle the pending operand and operator.
      const last = expressionParts[expressionParts.length - 1];
      if (last && last.op) {
        // Last element is an operator. Use operandEntered to distinguish:
        //   - true → user entered a number (including explicit "0") — commit it, then push new op
        //   - false → user just pressed a different operator without entering digits — replace
        if (operandEntered) {
          // Commit the entered operand as a new value element, then push the new operator.
          // This preserves all previous operators for left-to-right evaluation.
          // After "2 + 3", parts = [{value:2}, {op:'+'}], currentInput='3'.
          // Pressing '*' → parts = [{value:2}, {op:'+'}, {value:3}, {op:'*'}].
          expressionParts.push({ value: parseFloat(currentInput) });
          expressionParts.push({ op });
          currentInput = '0';
          operandEntered = false;
        } else {
          // Replace the pending operator
          last.op = op;
        }
      } else {
        // Last element is a number, so commit current input as operand and push new operator.
        commitOperandAndPushOp(op);
      }
    }

    return getSnapshot();
  }

  /** Handle equals (evaluate). */
  function handleEquals() {
    // Check if the last part is an operator (user pressed op but didn't enter operand)
    const lastPart = expressionParts[expressionParts.length - 1];
    const hasTrailingOperator = lastPart && lastPart.op;

    // Commit the last pending operand before evaluating.
    // If there's a trailing operator AND no operand was entered, skip — no operand was typed.
    if (!hasTrailingOperator || operandEntered) {
      if (isValidNumber(currentInput)) {
        expressionParts.push({ value: parseFloat(currentInput) });
      } else if (currentInput === '' || currentInput === '-') {
        // Nothing to evaluate — do nothing
        return getSnapshot();
      }
    }

    // Extract nums and ops
    const nums = [];
    const ops = [];
    for (const p of expressionParts) {
      if (p.value !== undefined) nums.push(p.value);
      if (p.op) ops.push(p.op);
    }

    if (nums.length === 0) {
      currentInput = 'Error';
      justEvaluated = true;
      operandEntered = false;
      return getSnapshot();
    }

    // Strip trailing operators that have no matching right operand.
    while (ops.length > nums.length - 1 && nums.length >= 1) {
      ops.pop();
    }

    if (nums.length !== ops.length + 1 || nums.length === 0) {
      currentInput = 'Error';
      justEvaluated = true;
      operandEntered = false;
      return getSnapshot();
    }

    // Mark as evaluated so subsequent input behaves correctly.
    // The caller (app.js or tests) will call completeEvaluation(result)
    // after successful evaluation to sync the result back into state.
    lastResult = nums[0]; // default: single number
    currentInput = String(nums[0]);
    justEvaluated = true;
    operandEntered = false;

    return { nums, ops };
  }

  /** Sync a successful evaluation result back into state. */
  function completeEvaluation(value) {
    expressionParts = [];          // clear stale expression parts
    lastResult = value;
    currentInput = String(value);
    justEvaluated = true;
    operandEntered = false;
    return getSnapshot();
  }

  /** Sync an evaluation error back into state. */
  function completeError() {
    expressionParts = [];          // clear stale expression parts
    currentInput = 'Error';
    lastResult = null;
    justEvaluated = true;
    operandEntered = false;
    return getSnapshot();
  }

  /** Handle clear (AC). */
  function handleClear() {
    currentInput = '0';
    expressionParts = [];
    lastResult = null;
    justEvaluated = false;
    operandEntered = false;

    return getSnapshot();
  }

  /** Handle backspace. */
  function handleBackspace() {
    if (justEvaluated) return getSnapshot(); // Don't backspace after evaluation
    if (currentInput.length <= 1 || currentInput === 'Error') {
      currentInput = '0';
    } else {
      currentInput = currentInput.slice(0, -1);
    }

    return getSnapshot();
  }

  /** Get a snapshot of the current state for display. */
  function getSnapshot() {
    return {
      currentInput,
      expressionParts: [...expressionParts], // shallow copy
      lastResult,
      justEvaluated,
    };
  }

  /** Format expression string from parts (for UI display). */
  function formatExpression(parts) {
    return (parts || expressionParts).map(p => {
      if (p.op) return ` ${p.op} `;
      return String(p.value);
    }).join('');
  }

  // ---- Public API ----
  return {
    handleNum,
    handleDecimal,
    handleNegate,
    handleOp,
    handleEquals,
    completeEvaluation,
    completeError,
    handleClear,
    handleBackspace,
    getSnapshot,
    formatExpression,
    isValidNumber,
    splitCurrentNumber,
    commitOperandAndPushOp,
    startFreshAfterEquals,
    // Expose internal state for test synchronization
    _getInternalState: () => ({
      currentInput,
      expressionParts,
      lastResult,
      justEvaluated,
      operandEntered,
    }),
  };
}
