/**
 * Dependency-free unit conversion logic.
 *
 * `convert` computes at full precision and never rounds; callers round only
 * when formatting a value for display. It throws `TypeError` for invalid
 * types or unknown category/unit identifiers (including `Object.prototype`
 * names such as `toString` and `constructor`) and `RangeError` for physical
 * range violations (negative length/mass, temperatures below absolute zero)
 * or when a finite input overflows to a non-representable result.
 */

export const CATEGORIES = {
  length: {
    label: 'Length',
    base: 'meters',
    units: {
      meters: { label: 'Meters', factor: 1 },
      kilometers: { label: 'Kilometers', factor: 1000 },
      centimeters: { label: 'Centimeters', factor: 0.01 },
      feet: { label: 'Feet', factor: 0.3048 },
      inches: { label: 'Inches', factor: 0.0254 },
    },
  },
  mass: {
    label: 'Mass',
    base: 'kilograms',
    units: {
      kilograms: { label: 'Kilograms', factor: 1 },
      grams: { label: 'Grams', factor: 0.001 },
      pounds: { label: 'Pounds', factor: 0.45359237 },
      ounces: { label: 'Ounces', factor: 0.028349523125 },
    },
  },
  temperature: {
    label: 'Temperature',
    base: 'celsius',
    units: {
      celsius: { label: 'Celsius' },
      fahrenheit: { label: 'Fahrenheit' },
      kelvin: { label: 'Kelvin' },
    },
  },
};

/** Absolute zero per temperature unit: celsius -273.15, fahrenheit -459.67, kelvin 0. */
const ABSOLUTE_ZERO = { celsius: -273.15, fahrenheit: -459.67, kelvin: 0 };

// Each conversion divides by the larger scalar before multiplying by the
// smaller one so that a large finite input (e.g. 1e308) does not overflow the
// intermediate product. `((value - 32) * 5)` overflows at 1e308 because
// 5 * 1e308 > MAX_VALUE, while `(value - 32) / 9 * 5` stays representable.
function toCelsius(value, from) {
  switch (from) {
    case 'celsius':
      return value;
    case 'fahrenheit':
      return (value - 32) / 9 * 5;
    case 'kelvin':
      return value - 273.15;
  }
  throw new Error(`unreachable: unknown temperature unit "${from}"`);
}

function fromCelsius(value, to) {
  switch (to) {
    case 'celsius':
      return value;
    case 'fahrenheit':
      return value / 5 * 9 + 32;
    case 'kelvin':
      return value + 273.15;
  }
  throw new Error(`unreachable: unknown temperature unit "${to}"`);
}

/**
 * Look up an entry in a plain-object table using an own-property check only.
 *
 * `table[key]` would also resolve inherited `Object.prototype` names such as
 * `toString`, `constructor`, and `__proto__`, so validate with
 * `Object.hasOwn` first. This keeps unknown and prototype-named identifiers
 * uniformly rejected with `TypeError`.
 *
 * @param {Record<string, unknown>} table
 * @param {unknown} key
 * @param {string} label e.g. "category" or `unit "..." for category "..."`
 * @param {string[]} valid the list of valid keys, for the error message
 * @returns {unknown} the matched entry
 */
function lookup(table, key, label, valid) {
  if (typeof key !== 'string' || !Object.hasOwn(table, key)) {
    throw new TypeError(
      `unsupported ${label} "${String(key)}"; expected one of: ${valid.join(', ')}`,
    );
  }
  return table[key];
}

/**
 * Convert a finite numeric `value` between two units of the same category.
 *
 * A conversion to the identical unit returns the input unchanged (a true
 * identity, not a factor round-trip), so the value is preserved exactly.
 *
 * @param {number} value
 * @param {keyof typeof CATEGORIES} category
 * @param {string} fromUnit
 * @param {string} toUnit
 * @returns {number} full-precision converted value
 */
export function convert(value, category, fromUnit, toUnit) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(
      `value must be a finite number, received ${JSON.stringify(value)}`,
    );
  }
  const def = lookup(CATEGORIES, category, 'category', Object.keys(CATEGORIES));
  const from = lookup(def.units, fromUnit, `unit "${String(fromUnit)}" for category "${category}"`, Object.keys(def.units));
  const to = lookup(def.units, toUnit, `unit "${String(toUnit)}" for category "${category}"`, Object.keys(def.units));

  if (category === 'temperature') {
    if (value < ABSOLUTE_ZERO[fromUnit]) {
      throw new RangeError(
        `${from.label} cannot be below absolute zero (${ABSOLUTE_ZERO[fromUnit]} ${from.label})`,
      );
    }
    if (fromUnit === toUnit) {
      return value;
    }
    const result = fromCelsius(toCelsius(value, fromUnit), toUnit);
    return ensureFinite(result, `${from.label} to ${to.label}`);
  }

  if (value < 0) {
    throw new RangeError(`${def.label} cannot be negative`);
  }
  if (fromUnit === toUnit) {
    return value;
  }
  // Convert via the ratio from.factor / to.factor instead of (value * from.factor) /
  // to.factor. The ratio is always a modest number (at most ~39370 for
  // kilometers -> inches here), so `value * ratio` overflows only when the true
  // result genuinely exceeds the numeric range. This avoids the intermediate
  // overflow the two-step multiply-then-divide form could hit for large finite
  // values whose true result is still representable.
  const result = value * (from.factor / to.factor);
  return ensureFinite(result, `${from.label} to ${to.label}`);
}

/**
 * Guard against finite inputs that overflow into a non-representable result.
 * A finite input that converts to a non-finite number is a range failure, not
 * a valid conversion, so surface it as a clear RangeError instead of letting
 * `Infinity`/`NaN` reach the caller.
 */
function ensureFinite(result, description) {
  if (!Number.isFinite(result)) {
    throw new RangeError(
      `result of ${description} exceeds the range of representable numbers`,
    );
  }
  return result;
}
