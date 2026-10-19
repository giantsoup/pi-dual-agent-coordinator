/**
 * Pure arithmetic engine for the calculator.
 *
 * This module is intentionally DOM-independent: it uses no browser APIs,
 * no eval(), and no Function(). It can run in the browser (ES module) and
 * in Node (node:test) without modification.
 *
 * Expressions are expressed as an array of alternating numeric and operator
 * tokens, e.g. [2, "+", 3, "*", 4], and are evaluated strictly left-to-right
 * (no operator precedence), like a classic four-function calculator.
 */

export const OPERATORS = Object.freeze(["+", "-", "*", "/"]);

/** Base error for all arithmetic failures. `code` identifies the cause. */
export class ArithmeticError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "ArithmeticError";
    this.code = code;
  }
}

/** Recoverable error thrown when a division operand is zero. */
export class DivisionByZeroError extends ArithmeticError {
  constructor(message = "Division by zero is not allowed.") {
    super(message, "DIVISION_BY_ZERO");
    this.name = "DivisionByZeroError";
  }
}

/**
 * Normalize a finite number to at most 12 significant digits so binary
 * floating-point noise is removed (0.1 + 0.2 === 0.3).
 *
 * @param {number} value
 * @returns {number}
 * @throws {ArithmeticError} when the value is not a finite number.
 */
export function normalizeNumber(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ArithmeticError(
      "Value is not a finite number: " + String(value),
      "NOT_FINITE"
    );
  }
  return Number(value.toPrecision(12));
}

/** Convert a numeric token (number or numeric string) to a finite number. */
function toNumber(token, index) {
  let value;
  if (typeof token === "number") {
    value = token;
  } else if (typeof token === "string" && token.trim() !== "") {
    value = Number(token);
  } else {
    throw new ArithmeticError(
      "Token at index " + index + " is not a number: " + String(token),
      "INVALID_TOKEN"
    );
  }
  if (!Number.isFinite(value)) {
    throw new ArithmeticError(
      "Token at index " + index + " is not a finite number: " + String(token),
      "INVALID_TOKEN"
    );
  }
  return value;
}

function applyOperator(left, operator, right) {
  switch (operator) {
    case "+":
      return left + right;
    case "-":
      return left - right;
    case "*":
      return left * right;
    case "/":
      if (right === 0) {
        throw new DivisionByZeroError();
      }
      return left / right;
    default:
      throw new ArithmeticError(
        "Unsupported operator: " + String(operator),
        "UNSUPPORTED_OPERATOR"
      );
  }
}

/**
 * Evaluate an expression strictly left-to-right.
 *
 * @param {Array<number|string>} tokens Alternating numbers and operators,
 *   e.g. [2, "+", 3, "*", 4] or ["0.1", "+", "0.2"]. Numeric tokens may be
 *   numbers or numeric strings; operators must be "+", "-", "*", or "/".
 * @returns {number} The normalized result.
 * @throws {ArithmeticError} with code MALFORMED_EXPRESSION, INVALID_TOKEN,
 *   UNSUPPORTED_OPERATOR, NOT_FINITE, or DIVISION_BY_ZERO.
 */
export function calculate(tokens) {
  if (!Array.isArray(tokens)) {
    throw new ArithmeticError("Tokens must be an array.", "MALFORMED_EXPRESSION");
  }
  if (tokens.length === 0) {
    throw new ArithmeticError("Expression is empty.", "MALFORMED_EXPRESSION");
  }
  if (tokens.length % 2 === 0) {
    throw new ArithmeticError(
      "Expression must alternate number, operator, number, ...",
      "MALFORMED_EXPRESSION"
    );
  }

  let result = normalizeNumber(toNumber(tokens[0], 0));
  for (let i = 1; i < tokens.length; i += 2) {
    const operator = tokens[i];
    if (typeof operator !== "string" || !OPERATORS.includes(operator)) {
      throw new ArithmeticError(
        "Unsupported operator at index " + i + ": " + String(operator),
        "UNSUPPORTED_OPERATOR"
      );
    }
    const operand = toNumber(tokens[i + 1], i + 1);
    result = normalizeNumber(applyOperator(result, operator, operand));
  }
  return result;
}

/** Alias for {@link calculate}. */
export const evaluate = calculate;
