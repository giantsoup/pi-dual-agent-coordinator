/**
 * Calculator UI controller.
 *
 * Wires the HTML keypad and keyboard input to the DOM-independent
 * arithmetic engine in arithmetic.js. All evaluation goes through
 * calculate(); this file never uses eval() or Function().
 */

import {
  calculate,
  ArithmeticError,
  DivisionByZeroError,
} from "./arithmetic.js";

// ---------------------------------------------------------------------------
// DOM references
// ---------------------------------------------------------------------------

const displayEl = document.getElementById("display");
const expressionEl = document.getElementById("expression");
const keysEl = document.getElementById("keys");

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_INPUT_LENGTH = 16; // max digits in a single entry

const OPERATOR_SYMBOLS = {
  "+": "+",
  "-": "\u2212",
  "*": "\u00d7",
  "/": "\u00f7",
};

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const state = {
  /** The number currently being typed, as a string (e.g. "12.5", "-3"). */
  input: "0",
  /** True while the display shows live user input (not a computed value). */
  inputActive: true,
  /** The left-hand value of a pending operation, or null. */
  pendingValue: null,
  /** The pending operator ("+" | "-" | "*" | "/") or null. */
  pendingOp: null,
  /** True immediately after pressing equals. */
  justEvaluated: false,
  /** True when a recoverable error (e.g. division by zero) is showing. */
  error: false,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isZeroInput(s) {
  return Number(s) === 0;
}

function digitCount(s) {
  return s.replace(/[^0-9]/g, "").length;
}

function parseInput(s) {
  if (s === "" || s === "-" || s === "-0") return 0;
  const value = Number(s);
  if (!Number.isFinite(value)) {
    throw new ArithmeticError("Invalid input: " + s, "INVALID_TOKEN");
  }
  return value;
}

function operatorSymbol(op) {
  return OPERATOR_SYMBOLS[op] || op;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function currentDisplayString() {
  if (state.error) return "Error";
  if (state.inputActive) return state.input;
  if (state.justEvaluated) return state.input; // input holds the result string
  if (state.pendingValue === null) return "0";
  return String(state.pendingValue);
}

function buildExpression() {
  if (state.error) return "";
  if (state.pendingOp !== null && state.pendingValue !== null) {
    return String(state.pendingValue) + " " + operatorSymbol(state.pendingOp);
  }
  return "";
}

function render() {
  displayEl.textContent = currentDisplayString();
  displayEl.classList.toggle("calculator__display--error", state.error);
  expressionEl.textContent = buildExpression();
}

// ---------------------------------------------------------------------------
// State transitions
// ---------------------------------------------------------------------------

function resetState() {
  state.input = "0";
  state.inputActive = true;
  state.pendingValue = null;
  state.pendingOp = null;
  state.justEvaluated = false;
  state.error = false;
}

function showError() {
  state.error = true;
  state.input = "0";
  state.inputActive = false;
  state.pendingValue = null;
  state.pendingOp = null;
  state.justEvaluated = false;
}

/**
 * If the display is showing a computed value (not live input),
 * reset the input buffer so the next digit starts a fresh entry.
 */
function beginFreshInputIfShowingComputed() {
  if (!state.inputActive) {
    state.input = "0";
    state.inputActive = true;
  }
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

function inputDigit(d) {
  if (state.error) resetState();

  if (state.justEvaluated) {
    // Start a brand-new calculation from the shown result.
    state.pendingValue = null;
    state.pendingOp = null;
    state.justEvaluated = false;
    state.input = "0";
    state.inputActive = true;
  } else {
    beginFreshInputIfShowingComputed();
  }

  if (state.input.endsWith(".")) {
    // e.g. "0." + "5" -> "0.5"
    if (digitCount(state.input) < MAX_INPUT_LENGTH) state.input += d;
  } else if (isZeroInput(state.input)) {
    const sign = state.input.startsWith("-") ? "-" : "";
    state.input = sign + d;
  } else if (digitCount(state.input) < MAX_INPUT_LENGTH) {
    state.input += d;
  }
  render();
}

function inputDecimal() {
  if (state.error) resetState();

  if (state.justEvaluated) {
    state.pendingValue = null;
    state.pendingOp = null;
    state.justEvaluated = false;
    state.input = "0";
    state.inputActive = true;
  } else {
    beginFreshInputIfShowingComputed();
  }

  // Prevent duplicate decimal points.
  if (state.input.includes(".")) return;

  state.input += ".";
  render();
}

function inputOperator(op) {
  if (state.error) return; // must clear or type a digit to recover

  if (state.justEvaluated) {
    // Chain a new operation from the shown result.
    const result = parseInput(state.input);
    state.pendingValue = result;
    state.pendingOp = op;
    state.input = "0";
    state.inputActive = false;
    state.justEvaluated = false;
    render();
    return;
  }

  if (state.pendingOp !== null && !state.inputActive) {
    // Operator pressed right after another: replace the pending operator.
    state.pendingOp = op;
    render();
    return;
  }

  const value = parseInput(state.input);
  let next;
  try {
    next =
      state.pendingValue === null
        ? value
        : calculate([state.pendingValue, state.pendingOp, value]);
  } catch (err) {
    if (err instanceof ArithmeticError) {
      showError();
      render();
      return;
    }
    throw err;
  }

  state.pendingValue = next;
  state.pendingOp = op;
  state.input = "0";
  state.inputActive = false;
  render();
}

function equals() {
  if (state.error) return;

  let result;
  try {
    if (state.pendingOp === null || state.pendingValue === null) {
      result = calculate([parseInput(state.input)]);
    } else {
      result = calculate([
        state.pendingValue,
        state.pendingOp,
        parseInput(state.input),
      ]);
    }
  } catch (err) {
    if (err instanceof ArithmeticError) {
      showError();
      render();
      return;
    }
    throw err;
  }

  state.input = String(result);
  state.inputActive = false;
  state.pendingValue = null;
  state.pendingOp = null;
  state.justEvaluated = true;
  render();
}

function negate() {
  if (state.error) return;

  if (state.justEvaluated) {
    // Negate the shown result and start a new calculation with it.
    const v = parseInput(state.input);
    state.input = String(-v);
    state.inputActive = true;
    state.justEvaluated = false;
    state.pendingValue = null;
    state.pendingOp = null;
    render();
    return;
  }

  if (!state.inputActive) {
    // Display shows a pending intermediate; start a fresh negative entry.
    state.input = "-0";
    state.inputActive = true;
    render();
    return;
  }

  if (state.input.startsWith("-")) {
    state.input = state.input.slice(1);
  } else {
    state.input = "-" + state.input;
  }
  render();
}

function backspace() {
  if (state.error) {
    resetState();
    render();
    return;
  }
  if (!state.inputActive || state.justEvaluated) return; // ignore on results

  // Delete the last character, then normalize degenerate results so the
  // entry is always usable.
  //   "1."  -> "1"    "12" -> "1"    "1" -> "0"
  //   "-1"  -> "-0"   (preserve sign so next digit stays negative)
  //   "-0"  -> "0"    (negative zero collapses)
  //   "-1.5" -> "-1."  "-0.5" -> "-0."
  const next = state.input.slice(0, -1);
  if (next === "") {
    state.input = "0";
  } else if (next === "-") {
    // Sliced to a bare "-": the original was "-0" or "-<digit>".
    // If the original was exactly "-0", collapse to "0"; otherwise keep
    // the sign as "-0" so subsequent digits remain negative.
    state.input = state.input === "-0" ? "0" : "-0";
  } else {
    state.input = next;
  }
  render();
}

function clearAll() {
  resetState();
  render();
}

// ---------------------------------------------------------------------------
// Event wiring
// ---------------------------------------------------------------------------

// Keypad clicks (mouse and touch both fire click events).
keysEl.addEventListener("click", (event) => {
  const button = event.target.closest(
    "button[data-digit], button[data-operator], button[data-action]"
  );
  if (!button || !keysEl.contains(button)) return;

  if (button.hasAttribute("data-digit")) {
    inputDigit(button.getAttribute("data-digit"));
  } else if (button.hasAttribute("data-operator")) {
    inputOperator(button.getAttribute("data-operator"));
  } else {
    const action = button.getAttribute("data-action");
    if (action === "clear") clearAll();
    else if (action === "negate") negate();
    else if (action === "backspace") backspace();
    else if (action === "decimal") inputDecimal();
    else if (action === "equals") equals();
  }
});

// Keyboard controls.
window.addEventListener("keydown", (event) => {
  if (event.ctrlKey || event.metaKey || event.altKey) return;

  const key = event.key;

  if (/^[0-9]$/.test(key)) {
    event.preventDefault();
    inputDigit(key);
    return;
  }
  if (key === "." || key === ",") {
    event.preventDefault();
    inputDecimal();
    return;
  }
  if (key === "+") {
    event.preventDefault();
    inputOperator("+");
    return;
  }
  if (key === "-") {
    event.preventDefault();
    inputOperator("-");
    return;
  }
  if (key === "*" || key.toLowerCase() === "x") {
    event.preventDefault();
    inputOperator("*");
    return;
  }
  if (key === "/") {
    event.preventDefault(); // avoid Firefox quick-find
    inputOperator("/");
    return;
  }
  if (key === "Enter" || key === "=") {
    event.preventDefault(); // avoid double-firing on focused buttons
    equals();
    return;
  }
  if (key === "Escape") {
    event.preventDefault();
    clearAll();
    return;
  }
  if (key === "Backspace") {
    event.preventDefault();
    backspace();
    return;
  }
});

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

resetState();
render();
