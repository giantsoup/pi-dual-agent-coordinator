/**
 * Calculator module with pure arithmetic operations.
 * No DOM dependencies. Exported functions handle validation and formatting.
 */

/**
 * Formats a numeric result to avoid floating-point artifacts.
 * e.g., 0.1 + 0.2 = 0.3 instead of 0.30000000000000004
 * @param {number} value - The numeric value to format.
 * @returns {string} The formatted result as a string.
 */
export function formatResult(value) {
  if (!Number.isFinite(value)) {
    return String(value);
  }
  
  // Use toFixed with precision, then trim trailing zeros
  const formatted = value.toFixed(10);
  return parseFloat(formatted).toString();
}

/**
 * Performs a single arithmetic operation.
 * @param {number} left - Left operand.
 * @param {string} operator - One of '+', '-', '*', '/'.
 * @param {number} right - Right operand.
 * @returns {string} The result as a formatted string.
 * @throws {Error} If operands are invalid or operator is unsupported.
 */
export function calculate(left, operator, right) {
  // Validate operands are finite numbers
  if (!Number.isFinite(left) || !Number.isFinite(right)) {
    throw new Error('Invalid operands: both must be finite numbers');
  }
  
  // Validate operator
  const validOperators = ['+', '-', '*', '/'];
  if (!validOperators.includes(operator)) {
    throw new Error(`Invalid operator: '${operator}'. Supported operators: ${validOperators.join(', ')}`);
  }
  
  // Perform operation
  let result;
  switch (operator) {
    case '+':
      result = left + right;
      break;
    case '-':
      result = left - right;
      break;
    case '*':
      result = left * right;
      break;
    case '/':
      if (right === 0) {
        throw new Error('Division by zero is not allowed');
      }
      result = left / right;
      break;
  }
  
  return formatResult(result);
}

/**
 * Evaluates a chain of numbers and operators from left to right.
 * e.g., [2, 3, 4] with ['+', '*'] computes (2 + 3) * 4 = 20
 * @param {number[]} numbers - Array of numeric operands.
 * @param {string[]} operators - Array of operator strings.
 * @returns {string} The final result as a formatted string.
 * @throws {Error} If input is invalid or division by zero occurs.
 */
export function evaluateChain(numbers, operators) {
  // Validate inputs
  if (!Array.isArray(numbers) || !Array.isArray(operators)) {
    throw new Error('Invalid input: numbers and operators must be arrays');
  }
  
  if (numbers.length === 0) {
    throw new Error('At least one number is required');
  }
  
  if (operators.length !== numbers.length - 1) {
    throw new Error('Operators count must be exactly one less than numbers count');
  }
  
  // Validate all numbers are finite
  for (const num of numbers) {
    if (!Number.isFinite(num)) {
      throw new Error('All numbers must be finite');
    }
  }
  
  // Validate all operators
  const validOperators = ['+', '-', '*', '/'];
  for (const op of operators) {
    if (!validOperators.includes(op)) {
      throw new Error(`Invalid operator: '${op}'`);
    }
  }
  
  // Evaluate left to right
  let result = numbers[0];
  for (let i = 0; i < operators.length; i++) {
    const operator = operators[i];
    
    if (operator === '/' && numbers[i + 1] === 0) {
      throw new Error('Division by zero is not allowed');
    }
    
    result = calculate(result, operator, numbers[i + 1]);
    result = parseFloat(result);
  }
  
  return formatResult(result);
}

/**
 * Parses a numeric string to a JavaScript number.
 * @param {string} str - The string to parse.
 * @returns {number|null} The parsed number, or null if invalid.
 */
export function parseNumber(str) {
  if (str === '' || str === '-') {
    return null;
  }
  const num = Number(str);
  return Number.isFinite(num) ? num : null;
}
