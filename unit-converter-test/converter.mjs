/**
 * Dependency-free unit conversion logic.
 *
 * `convert` computes at full precision and never rounds; callers round only
 * when formatting a value for display. It throws `TypeError` for invalid
 * types or unknown category/unit identifiers and `RangeError` for physical
 * range violations (negative length/mass, temperatures below absolute zero).
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

function toCelsius(value, from) {
  switch (from) {
    case 'celsius':
      return value;
    case 'fahrenheit':
      return ((value - 32) * 5) / 9;
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
      return (value * 9) / 5 + 32;
    case 'kelvin':
      return value + 273.15;
  }
  throw new Error(`unreachable: unknown temperature unit "${to}"`);
}

/**
 * Convert a finite numeric `value` between two units of the same category.
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
  const def = CATEGORIES[category];
  if (!def) {
    throw new TypeError(
      `unsupported category "${String(category)}"; expected one of: ${Object.keys(CATEGORIES).join(', ')}`,
    );
  }
  const from = def.units[fromUnit];
  if (!from) {
    throw new TypeError(
      `unsupported unit "${String(fromUnit)}" for category "${category}"; expected one of: ${Object.keys(def.units).join(', ')}`,
    );
  }
  const to = def.units[toUnit];
  if (!to) {
    throw new TypeError(
      `unsupported unit "${String(toUnit)}" for category "${category}"; expected one of: ${Object.keys(def.units).join(', ')}`,
    );
  }

  if (category === 'temperature') {
    if (value < ABSOLUTE_ZERO[fromUnit]) {
      throw new RangeError(
        `${from.label} cannot be below absolute zero (${ABSOLUTE_ZERO[fromUnit]} ${from.label})`,
      );
    }
    const result = fromCelsius(toCelsius(value, fromUnit), toUnit);
    return ensureFinite(result, `${from.label} to ${to.label}`);
  }

  if (value < 0) {
    throw new RangeError(`${def.label} cannot be negative`);
  }
  const result = (value * from.factor) / to.factor;
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
