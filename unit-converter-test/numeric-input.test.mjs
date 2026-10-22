import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseNumericInput } from './numeric-input.mjs';

test('parses plain and signed decimals', () => {
  assert.deepEqual(parseNumericInput('42'), { status: 'valid', value: 42 });
  assert.deepEqual(parseNumericInput('-7'), { status: 'valid', value: -7 });
  assert.deepEqual(parseNumericInput('+7'), { status: 'valid', value: 7 });
  assert.deepEqual(parseNumericInput('3.14'), { status: 'valid', value: 3.14 });
});

test('parses trimmed input with surrounding whitespace', () => {
  assert.deepEqual(parseNumericInput('  42  '), { status: 'valid', value: 42 });
  assert.deepEqual(parseNumericInput('\t-1.5\n'), { status: 'valid', value: -1.5 });
});

test('parses bare leading-fraction and trailing-dot forms', () => {
  // `.5` is a valid JS number literal; `5.` is too.
  assert.deepEqual(parseNumericInput('.5'), { status: 'valid', value: 0.5 });
  assert.deepEqual(parseNumericInput('5.'), { status: 'valid', value: 5 });
  assert.deepEqual(parseNumericInput('-.25'), { status: 'valid', value: -0.25 });
});

test('parses scientific notation with signed exponents', () => {
  assert.deepEqual(parseNumericInput('1e3'), { status: 'valid', value: 1000 });
  assert.deepEqual(parseNumericInput('1E3'), { status: 'valid', value: 1000 });
  assert.deepEqual(parseNumericInput('1e-3'), { status: 'valid', value: 0.001 });
  assert.deepEqual(parseNumericInput('1.5e+2'), { status: 'valid', value: 150 });
  assert.deepEqual(parseNumericInput('.5e2'), { status: 'valid', value: 50 });
});

test('parses a literal that is exactly zero', () => {
  assert.deepEqual(parseNumericInput('0'), { status: 'valid', value: 0 });
  assert.deepEqual(parseNumericInput('0.0'), { status: 'valid', value: 0 });
  assert.deepEqual(parseNumericInput('-0'), { status: 'valid', value: -0 });
  // `0e-9999` is a zero literal; the significand is 0, so it is valid zero.
  assert.deepEqual(parseNumericInput('0e-9999'), { status: 'valid', value: 0 });
});

test('treats empty and whitespace-only input as the empty outcome', () => {
  assert.deepEqual(parseNumericInput(''), { status: 'empty' });
  assert.deepEqual(parseNumericInput('   '), { status: 'empty' });
  assert.deepEqual(parseNumericInput('\t\n'), { status: 'empty' });
});

test('rejects malformed text', () => {
  for (const bad of ['abc', '1.2.3', '--5', '1e', '1e+', '1e-', '.', '+', '1 2', '1,000', '5#']) {
    const result = parseNumericInput(bad);
    assert.equal(result.status, 'invalid', `expected invalid for ${JSON.stringify(bad)}`);
  }
});

test('rejects hexadecimal, binary, and octal notation', () => {
  for (const bad of ['0x10', '0X10', '0b101', '0o17', '0x', '0b', '0o']) {
    const result = parseNumericInput(bad);
    assert.equal(result.status, 'invalid', `expected invalid for ${bad}`);
  }
});

test('treats a leading-zero decimal as a normal decimal (not octal)', () => {
  // In modern JS Number('010') is the decimal 10, not octal, so the parser
  // accepts it as a plain decimal literal.
  assert.deepEqual(parseNumericInput('010'), { status: 'valid', value: 10 });
  assert.deepEqual(parseNumericInput('007'), { status: 'valid', value: 7 });
});

test('rejects NaN and infinity literals', () => {
  for (const bad of ['NaN', 'Infinity', '-Infinity', '+Infinity', 'inf', '-inf']) {
    const result = parseNumericInput(bad);
    assert.equal(result.status, 'invalid', `expected invalid for ${bad}`);
  }
});

test('rejects overflow (a large exponent that produces Infinity)', () => {
  const result = parseNumericInput('1e400');
  assert.equal(result.status, 'invalid');
  assert.equal(result.reason, 'number is too large');
  // A value already past MAX_VALUE.
  assert.equal(parseNumericInput('1e309').status, 'invalid');
});

test('rejects nonzero values that underflow to zero', () => {
  // 1e-9999 is a nonzero literal that Number() collapses to 0.
  const result = parseNumericInput('1e-9999');
  assert.equal(result.status, 'invalid');
  assert.equal(result.reason, 'number is too small');
  // A nonzero significand with a huge negative exponent (0.5e-1000 -> 0).
  assert.equal(parseNumericInput('0.5e-1000').status, 'invalid');
  // A decimal so tiny it underflows below the smallest subnormal (~5e-324).
  const tiny = '0.' + '0'.repeat(330) + '1';
  assert.equal(Number(tiny), 0, 'sanity: this literal underflows to 0');
  assert.equal(parseNumericInput(tiny).status, 'invalid');
  assert.equal(parseNumericInput(tiny).reason, 'number is too small');
})

test('rejects non-string input without throwing', () => {
  assert.equal(parseNumericInput(42).status, 'invalid');
  assert.equal(parseNumericInput(null).status, 'invalid');
  assert.equal(parseNumericInput(undefined).status, 'invalid');
  assert.equal(parseNumericInput({}).status, 'invalid');
});