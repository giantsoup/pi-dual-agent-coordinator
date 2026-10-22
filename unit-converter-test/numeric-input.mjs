/**
 * Dependency-free strict numeric input parser for the converter's value field.
 *
 * Unlike `Number(text)`, which silently accepts hexadecimal (`0x10`), binary
 * (`0b1`), octal (`0o10`/`010`), whitespace-riddled strings, `NaN`, and the
 * `Infinity` literals, this parser accepts *only* a trimmed, signed decimal
 * or scientific-notation number. It distinguishes three outcomes so the UI can
 * keep empty input neutral while surfacing genuinely invalid text:
 *
 *   { status: 'empty' }                — blank/whitespace-only input
 *   { status: 'invalid', reason }      — text that is not a valid number
 *   { status: 'valid', value }         — a finite number safely representable
 *
 * "Nonzero underflow" (a tiny but nonzero literal that `Number` collapses to
 * `0`, e.g. `1e-9999`) is reported as `invalid` rather than silently turning a
 * meaningful value into zero.
 */

// A strict decimal or scientific-notation literal. Accepts an optional leading
// sign, an integer part and/or a fraction part (at least one digit required),
// and an optional exponent. Leading/trailing whitespace is allowed and trimmed.
const DECIMAL_RE =
  /^([+-]?)((\d+(\.\d*)?)|(\.\d+))([eE]([+-]?\d+))?$/;

/**
 * Parse a user-entered value string.
 *
 * @param {string} raw
 * @returns {{status:'empty'} | {status:'invalid', reason:string} | {status:'valid', value:number}}
 */
export function parseNumericInput(raw) {
  if (typeof raw !== 'string') {
    return { status: 'invalid', reason: 'not a string' };
  }
  const trimmed = raw.trim();
  if (trimmed === '') {
    return { status: 'empty' };
  }

  const match = DECIMAL_RE.exec(trimmed);
  if (!match) {
    return { status: 'invalid', reason: 'not a valid number' };
  }

  const value = Number(trimmed);
  if (Number.isNaN(value)) {
    return { status: 'invalid', reason: 'not a valid number' };
  }
  if (!Number.isFinite(value)) {
    // Overflow (or an explicitly large exponent) produced Infinity.
    return { status: 'invalid', reason: 'number is too large' };
  }
  if (value === 0 && hasNonzeroSignificandDigit(trimmed)) {
    // A nonzero literal that underflowed to zero: the user entered a real, if
    // tiny, quantity, so we must not silently report it as exactly zero.
    return { status: 'invalid', reason: 'number is too small' };
  }
  return { status: 'valid', value };
}

/**
 * Return true if `text` contains any nonzero digit in its significand (the
 * portion before an optional exponent). Used to detect nonzero literals that
 * the `Number()` conversion collapses to `0` through underflow.
 *
 * @param {string} text a trimmed numeric literal
 * @returns {boolean}
 */
function hasNonzeroSignificandDigit(text) {
  const significand = text.split(/[eE]/)[0];
  return /[1-9]/.test(significand);
}