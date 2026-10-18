/**
 * calculator.mjs — Pure arithmetic module.
 * No DOM, no eval(), no Function(). All operations are explicit.
 */

// Round to avoid floating-point display artifacts (e.g. 0.1 + 0.2 → 0.3)
function roundResult(value) {
  return parseFloat(value.toPrecision(12));
}

/**
 * Perform a single binary operation.
 * @param {number} left
 * @param {string} operator — '+', '-', '*', '/'
 * @param {number} right
 * @returns {number} result
 * @throws {Error} on division by zero, unknown operator, or non-finite result
 */
export function operate(left, operator, right) {
  // Reject non-finite operands to prevent Infinity/NaN propagation
  if (!isFinite(left) || !isFinite(right)) {
    throw new Error('Non-finite operand');
  }

  let raw;
  switch (operator) {
    case '+':
      raw = left + right;
      break;
    case '-':
      raw = left - right;
      break;
    case '*':
      raw = left * right;
      break;
    case '/':
      if (right === 0) {
        throw new Error('Division by zero');
      }
      raw = left / right;
      break;
    default:
      throw new Error(`Unknown operator: ${operator}`);
  }

  // Reject non-finite results (e.g. overflow from 1e308 * 1e308)
  if (!isFinite(raw)) {
    throw new Error('Non-finite result');
  }

  return roundResult(raw);
}

/**
 * Evaluate a left-to-right chain of numbers and operators.
 * @param {number[]} nums — e.g. [2, '+', 3, '*', 4] flattened to [2, 3, 4] with ops ['+', '*']
 * @param {string[]} ops — e.g. ['+', '*']
 * @returns {{ result: number } | { error: string }}
 */
export function evaluate(nums, ops) {
  if (nums.length === 0 || nums.length !== ops.length + 1) {
    return { error: 'Incomplete expression' };
  }

  // Validate all input operands are finite numbers before processing.
  for (const n of nums) {
    if (typeof n !== 'number' || !isFinite(n)) {
      return { error: 'Non-finite operand' };
    }
  }

  let acc = nums[0];
  for (let i = 0; i < ops.length; i++) {
    try {
      acc = operate(acc, ops[i], nums[i + 1]);
    } catch (e) {
      return { error: e.message };
    }
  }

  // Guard the final result against non-finite values.
  if (!isFinite(acc)) {
    return { error: 'Non-finite result' };
  }

  return { result: acc };
}

/**
 * Format a number for display.
 * Returns 'Error' for NaN, Infinity, or -Infinity.
 */
export function formatDisplay(value) {
  if (typeof value !== 'number' || !isFinite(value)) {
    return 'Error';
  }
  const str = String(value);
  if (str.includes('e')) {
    // Scientific notation — cap decimal places
    return parseFloat(value.toPrecision(10)).toString();
  }
  return str;
}
