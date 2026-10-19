import { test } from "node:test";
import assert from "node:assert/strict";
import {
  calculate,
  evaluate,
  normalizeNumber,
  ArithmeticError,
  DivisionByZeroError,
} from "./arithmetic.js";

// --- All four basic operations -------------------------------------------------

test("adds two numbers", () => {
  assert.equal(calculate([2, "+", 3]), 5);
});

test("subtracts two numbers", () => {
  assert.equal(calculate([10, "-", 4]), 6);
});

test("multiplies two numbers", () => {
  assert.equal(calculate([6, "*", 7]), 42);
});

test("divides two numbers", () => {
  assert.equal(calculate([83, "/", 2]), 41.5);
});

test("evaluates a single number unchanged", () => {
  assert.equal(calculate([42]), 42);
});

test("evaluates a single negative number", () => {
  assert.equal(calculate([-7]), -7);
});

// --- Left-to-right chaining (no operator precedence) ---------------------------

test("evaluates 2 + 3 * 4 as 20 (left-to-right, not precedence)", () => {
  assert.equal(calculate([2, "+", 3, "*", 4]), 20);
});

test("evaluates a longer chain strictly left-to-right", () => {
  // (10 - 4) = 6; 6 + 2 = 8; 8 * 3 = 24
  assert.equal(calculate([10, "-", 4, "+", 2, "*", 3]), 24);
});

test("chained division is left-to-right", () => {
  // (100 / 5) = 20; 20 / 4 = 5
  assert.equal(calculate([100, "/", 5, "/", 4]), 5);
});

// --- Decimal normalization -----------------------------------------------------

test("normalizes 0.1 + 0.2 to exactly 0.3", () => {
  assert.equal(calculate([0.1, "+", 0.2]), 0.3);
});

test("normalizes chained decimal arithmetic", () => {
  assert.equal(calculate([0.1, "+", 0.2, "+", 0.3]), 0.6);
});

test("cancelling decimals yield exactly 0", () => {
  assert.equal(calculate([0.1, "+", 0.2, "-", 0.3]), 0);
});

test("accepts numeric strings as tokens", () => {
  assert.equal(calculate(["0.1", "+", "0.2"]), 0.3);
});

test("normalizeNumber strips floating-point noise", () => {
  assert.equal(normalizeNumber(0.30000000000000004), 0.3);
});

test("normalizeNumber rejects non-finite values", () => {
  assert.throws(() => normalizeNumber(Infinity), (e) => e.code === "NOT_FINITE");
  assert.throws(() => normalizeNumber(-Infinity), (e) => e.code === "NOT_FINITE");
  assert.throws(() => normalizeNumber(NaN), (e) => e.code === "NOT_FINITE");
});

// --- Negative values ------------------------------------------------------------

test("handles negative results", () => {
  assert.equal(calculate([5, "-", 8]), -3);
});

test("handles negative operands", () => {
  assert.equal(calculate([-4, "*", 2]), -8);
  assert.equal(calculate([3, "*", -2, "-", 1]), -7);
  assert.equal(calculate([-6, "/", 3]), -2);
});

// --- Division by zero -----------------------------------------------------------

test("division by zero throws a recoverable, coded error", () => {
  assert.throws(
    () => calculate([5, "/", 0]),
    (err) =>
      err instanceof DivisionByZeroError &&
      err instanceof ArithmeticError &&
      err.code === "DIVISION_BY_ZERO"
  );
});

test("division by zero mid-chain throws the same coded error", () => {
  assert.throws(() => calculate([1, "+", 5, "/", 0]), DivisionByZeroError);
});

test("division by zero from a zero intermediate result", () => {
  // (5 - 5) = 0; then 0 / 0 -> DIVISION_BY_ZERO
  assert.throws(() => calculate([5, "-", 5, "/", 0]), DivisionByZeroError);
});

// --- Malformed expressions -------------------------------------------------------

test("rejects an empty token array", () => {
  assert.throws(() => calculate([]), (e) => e.code === "MALFORMED_EXPRESSION");
});

test("rejects a trailing operator", () => {
  assert.throws(() => calculate([1, "+"]), (e) => e.code === "MALFORMED_EXPRESSION");
});

test("rejects two numbers with no operator", () => {
  assert.throws(() => calculate([1, 2]), (e) => e.code === "MALFORMED_EXPRESSION");
});

test("rejects non-array input", () => {
  assert.throws(() => calculate("1 + 2"), ArithmeticError);
  assert.throws(() => calculate(null), ArithmeticError);
  assert.throws(() => calculate(undefined), ArithmeticError);
});

test("rejects a leading operator (no first number)", () => {
  assert.throws(() => calculate(["+", 1, 2]), ArithmeticError);
});

// --- Invalid number tokens -------------------------------------------------------

test("rejects non-numeric string tokens", () => {
  assert.throws(() => calculate(["a", "+", 1]), (e) => e.code === "INVALID_TOKEN");
});

test("rejects NaN and Infinity tokens", () => {
  assert.throws(() => calculate([1, "+", NaN]), (e) => e.code === "INVALID_TOKEN");
  assert.throws(() => calculate([1, "+", Infinity]), (e) => e.code === "INVALID_TOKEN");
});

test("rejects non-string, non-number operator tokens", () => {
  assert.throws(() => calculate([1, 42, 2]), ArithmeticError);
});

// --- Unsupported operators -------------------------------------------------------

test("rejects unsupported operators", () => {
  assert.throws(() => calculate([1, "%", 2]), (e) => e.code === "UNSUPPORTED_OPERATOR");
  assert.throws(() => calculate([1, "^", 2]), (e) => e.code === "UNSUPPORTED_OPERATOR");
  assert.throws(() => calculate([1, "x", 2]), (e) => e.code === "UNSUPPORTED_OPERATOR");
  assert.throws(
    () => calculate([1, "+", 2, "%", 3]),
    (e) => e.code === "UNSUPPORTED_OPERATOR"
  );
});

// --- API compatibility -----------------------------------------------------------

test("evaluate is an alias of calculate", () => {
  assert.equal(evaluate, calculate);
  assert.equal(evaluate([2, "+", 3, "*", 4]), 20);
});
