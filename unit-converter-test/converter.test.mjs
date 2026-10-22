import { test } from 'node:test';
import assert from 'node:assert/strict';

import { CATEGORIES, convert } from './converter.mjs';

/**
 * Assert two numbers are equal within a small relative/absolute tolerance.
 * Relative tolerance keeps scaled magnitudes (e.g. kilograms) stable while
 * the absolute floor keeps tiny values (inches, kelvin offsets) strict.
 */
function assertClose(actual, expected, { rel = 1e-12, abs = 1e-12 } = {}) {
  const diff = Math.abs(actual - expected);
  const bound = Math.max(abs, rel * Math.max(Math.abs(actual), Math.abs(expected)));
  assert.ok(
    diff <= bound,
    `expected ${actual} to be within tolerance of ${expected} (diff ${diff} > ${bound})`,
  );
}

test('converts 1 meter to approximately 3.280839895 feet', () => {
  assertClose(convert(1, 'length', 'meters', 'feet'), 100 / 30.48);
});

test('converts 1 kilogram to 1000 grams', () => {
  assertClose(convert(1, 'mass', 'kilograms', 'grams'), 1000);
});

test('converts 100 Celsius to 212 Fahrenheit', () => {
  assertClose(convert(100, 'temperature', 'celsius', 'fahrenheit'), 212);
});

test('converts Celsius and Kelvin offsets correctly', () => {
  assertClose(convert(0, 'temperature', 'celsius', 'kelvin'), 273.15);
  assertClose(convert(273.15, 'temperature', 'kelvin', 'celsius'), 0);
  assertClose(convert(0, 'temperature', 'fahrenheit', 'celsius'), -17.77777777777778);
});

test('same-unit conversion returns the same value', () => {
  assertClose(convert(42, 'length', 'meters', 'meters'), 42);
  assertClose(convert(7, 'mass', 'pounds', 'pounds'), 7);
  assertClose(convert(300, 'temperature', 'kelvin', 'kelvin'), 300);
});

test('round trip meter -> feet -> meter is stable within tolerance', () => {
  const value = 1;
  const feet = convert(value, 'length', 'meters', 'feet');
  const back = convert(feet, 'length', 'feet', 'meters');
  assertClose(back, value);
});

test('temperature round trip stays at absolute zero across units', () => {
  const celsius = convert(0, 'temperature', 'kelvin', 'celsius');
  const fahrenheit = convert(celsius, 'temperature', 'celsius', 'fahrenheit');
  assertClose(fahrenheit, -459.67);
  assertClose(convert(fahrenheit, 'temperature', 'fahrenheit', 'kelvin'), 0);
});

test('rejects negative length', () => {
  assert.throws(() => convert(-1, 'length', 'meters', 'feet'), RangeError);
});

test('rejects negative mass', () => {
  assert.throws(() => convert(-0.5, 'mass', 'kilograms', 'grams'), RangeError);
});

test('rejects temperature below absolute zero in each unit', () => {
  assert.throws(() => convert(-273.16, 'temperature', 'celsius', 'fahrenheit'), RangeError);
  assert.throws(() => convert(-459.68, 'temperature', 'fahrenheit', 'celsius'), RangeError);
  assert.throws(() => convert(-0.1, 'temperature', 'kelvin', 'celsius'), RangeError);
});

test('accepts temperature exactly at absolute zero', () => {
  assertClose(convert(-273.15, 'temperature', 'celsius', 'kelvin'), 0);
  assertClose(convert(-459.67, 'temperature', 'fahrenheit', 'kelvin'), 0);
});

test('rejects finite inputs whose result overflows the numeric range (length)', () => {
  assert.throws(
    () => convert(Number.MAX_VALUE, 'length', 'meters', 'inches'),
    RangeError,
  );
});

test('rejects finite inputs whose result overflows the numeric range (temperature)', () => {
  assert.throws(
    () => convert(Number.MAX_VALUE, 'temperature', 'celsius', 'fahrenheit'),
    RangeError,
  );
});

test('never returns a non-finite value for a finite input', () => {
  const cases = [
    [Number.MAX_VALUE, 'length', 'meters', 'inches'],
    [Number.MAX_VALUE, 'mass', 'kilograms', 'grams'],
    [Number.MAX_VALUE, 'temperature', 'celsius', 'fahrenheit'],
  ];
  for (const [value, category, from, to] of cases) {
    try {
      const result = convert(value, category, from, to);
      assert.ok(Number.isFinite(result), `expected finite result for ${value} ${from} -> ${to}`);
    } catch (err) {
      assert.ok(err instanceof RangeError, `expected RangeError for ${value} ${from} -> ${to}`);
    }
  }
});

test('rejects non-finite values', () => {
  for (const bad of [NaN, Infinity, -Infinity]) {
    assert.throws(() => convert(bad, 'length', 'meters', 'feet'), TypeError);
  }
});

test('rejects non-number value types', () => {
  assert.throws(() => convert('5', 'length', 'meters', 'feet'), TypeError);
  assert.throws(() => convert(null, 'mass', 'kilograms', 'grams'), TypeError);
});

test('rejects unknown category', () => {
  assert.throws(() => convert(1, 'speed', 'mph', 'kph'), TypeError);
});

test('rejects unknown unit for a known category', () => {
  assert.throws(() => convert(1, 'length', 'meters', 'lightyears'), TypeError);
  assert.throws(() => convert(1, 'temperature', 'celsius', 'rankine'), TypeError);
});

test('exposes the expected categories and units', () => {
  assert.deepEqual(
    Object.keys(CATEGORIES),
    ['length', 'mass', 'temperature'],
  );
  assert.deepEqual(Object.keys(CATEGORIES.length.units).sort(), [
    'centimeters', 'feet', 'inches', 'kilometers', 'meters',
  ].sort());
  assert.deepEqual(Object.keys(CATEGORIES.mass.units).sort(), [
    'grams', 'kilograms', 'ounces', 'pounds',
  ].sort());
  assert.deepEqual(Object.keys(CATEGORIES.temperature.units).sort(), [
    'celsius', 'fahrenheit', 'kelvin',
  ].sort());
});

test('same-unit conversion returns the value unchanged exactly (extremes)', () => {
  // A conversion to the identical unit is a true identity, so values at the
  // numeric extremes come back bit-for-bit unchanged.
  assert.equal(convert(1e-20, 'temperature', 'kelvin', 'kelvin'), 1e-20);
  assert.equal(convert(1e308, 'length', 'kilometers', 'kilometers'), 1e308);
  assert.equal(convert(1e308, 'temperature', 'fahrenheit', 'fahrenheit'), 1e308);
  assert.equal(convert(1e308, 'mass', 'ounces', 'ounces'), 1e308);
});

test('fahrenheit->celsius near MAX_VALUE stays finite instead of overflowing', () => {
  // The old arithmetic ((value - 32) * 5) / 9 overflowed at (value - 32) * 5
  // because 5 * 1e308 exceeds Number.MAX_VALUE. Dividing by 9 first keeps the
  // intermediate representable, so the true result comes back finite.
  const result = convert(1e308, 'temperature', 'fahrenheit', 'celsius');
  assert.ok(Number.isFinite(result), `expected finite, got ${result}`);
  assertClose(result, 5.555555555555556e307);
});

test('large length conversions stay finite when the true result is representable', () => {
  // centimeters -> meters at 1e308 is 1e308 * 0.01 = 1e306 (finite). The
  // ratio-based formula keeps this finite.
  assertClose(convert(1e308, 'length', 'centimeters', 'meters'), 1e306);
  // feet -> meters at 1e308 is 1e308 * 0.3048 = 3.048e307 (finite). The old
  // (value * 0.3048) / 1 form was also fine here, but meters -> feet overflows
  // while feet -> meters stays finite, which the ratio formula handles.
  assertClose(convert(1e308, 'length', 'feet', 'meters'), 3.048e307);
  // meters -> kilometers at MAX_VALUE is finite (true result ~1.8e305), so it
  // must NOT be treated as overflow.
  assert.ok(
    Number.isFinite(convert(Number.MAX_VALUE, 'length', 'meters', 'kilometers')),
    'meters -> kilometers at MAX_VALUE should stay finite',
  );
});

test('genuine conversion overflow still throws RangeError', () => {
  // meters -> centimeters multiplies the value by 100; at 1e308 the true
  // result is 1e310, which is unrepresentable, so it must surface as a RangeError.
  assert.throws(
    () => convert(1e308, 'length', 'meters', 'centimeters'),
    RangeError,
  );
  // kilometers -> meters at 1e308 is a genuine overflow (true result 1e311).
  assert.throws(
    () => convert(1e308, 'length', 'kilometers', 'meters'),
    RangeError,
  );
  // meters -> inches at MAX_VALUE: true result ~3.9e310, unrepresentable.
  assert.throws(
    () => convert(Number.MAX_VALUE, 'length', 'meters', 'inches'),
    RangeError,
  );
  // Celsius -> Fahrenheit at MAX_VALUE: (MAX/5)*9 overflows to Infinity.
  assert.throws(
    () => convert(Number.MAX_VALUE, 'temperature', 'celsius', 'fahrenheit'),
    RangeError,
  );
});

test('rejects prototype-named identifiers in category/from/to positions', () => {
  const protoNames = ['toString', 'constructor', '__proto__', 'valueOf', 'hasOwnProperty'];
  for (const name of protoNames) {
    assert.throws(
      () => convert(1, name, 'meters', 'feet'),
      TypeError,
      `category ${name} should throw TypeError`,
    );
    assert.throws(
      () => convert(1, 'length', name, 'feet'),
      TypeError,
      `from unit ${name} should throw TypeError`,
    );
    assert.throws(
      () => convert(1, 'length', 'meters', name),
      TypeError,
      `to unit ${name} should throw TypeError`,
    );
  }
});

test('rejects non-string category/unit identifiers', () => {
  assert.throws(() => convert(1, {}, 'meters', 'feet'), TypeError);
  assert.throws(() => convert(1, null, 'meters', 'feet'), TypeError);
  assert.throws(() => convert(1, 'length', {}, 'feet'), TypeError);
  assert.throws(() => convert(1, 'length', 'meters', 42), TypeError);
});
