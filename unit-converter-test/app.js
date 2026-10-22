import { CATEGORIES, convert } from './converter.mjs';
import { parseNumericInput } from './numeric-input.mjs';

const form = document.getElementById('converter-form');
const categorySelect = document.getElementById('category');
const fromSelect = document.getElementById('fromUnit');
const toSelect = document.getElementById('toUnit');
const valueInput = document.getElementById('value');
const resultOutput = document.getElementById('result');
const statusEl = document.getElementById('status');
const swapButton = document.getElementById('swap');

function populateUnitSelects() {
  const def = CATEGORIES[categorySelect.value];
  const previousFrom = fromSelect.value;
  const previousTo = toSelect.value;

  fromSelect.textContent = '';
  toSelect.textContent = '';

  for (const [unit, meta] of Object.entries(def.units)) {
    const fromOption = new Option(meta.label, unit);
    const toOption = new Option(meta.label, unit);
    fromSelect.add(fromOption);
    toSelect.add(toOption);
  }

  // Preserve prior selections when they still exist in the new category.
  // Note: HTMLOptionsCollection.namedItem() matches by option *name*, not
  // value, so check the actual option values here.
  const hasOption = (select, value) =>
    Array.from(select.options).some((option) => option.value === value);

  fromSelect.value = hasOption(fromSelect, previousFrom) ? previousFrom : def.base;
  toSelect.value = hasOption(toSelect, previousTo) ? previousTo : defaultToFor(def, fromSelect.value);
}

function defaultToFor(def, fromUnit) {
  const units = Object.keys(def.units);
  return units.find((unit) => unit !== fromUnit) ?? units[0];
}

/** Format a finite number for display, rounding here (and only here). */
function formatResult(value) {
  return Number.isInteger(value)
    ? String(value)
    : String(Number(value.toPrecision(10)));
}

/**
 * Reflect the validation state of the value field onto its ARIA attributes.
 * `invalid` (true/false) sets or clears `aria-invalid`; empty and valid states
 * both clear it so only genuinely invalid input is flagged to assistive tech.
 *
 * @param {boolean} invalid
 */
function setAriaInvalid(invalid) {
  if (invalid) {
    valueInput.setAttribute('aria-invalid', 'true');
  } else {
    valueInput.removeAttribute('aria-invalid');
  }
}

function clearResult(message) {
  resultOutput.textContent = '';
  statusEl.textContent = message ?? '';
  statusEl.classList.toggle('error', Boolean(message));
}

function update() {
  const parsed = parseNumericInput(valueInput.value);

  if (parsed.status === 'empty') {
    // Empty input is neutral: clear the result and any error, and stop flagging
    // the field as invalid so an untouched field is not announced as broken.
    setAriaInvalid(false);
    clearResult('');
    return;
  }

  if (parsed.status === 'invalid') {
    setAriaInvalid(true);
    clearResult(reasonMessage(parsed.reason));
    return;
  }

  setAriaInvalid(false);
  const value = parsed.value;
  try {
    const result = convert(value, categorySelect.value, fromSelect.value, toSelect.value);
    clearResult('');
    const toLabel = CATEGORIES[categorySelect.value].units[toSelect.value].label;
    resultOutput.textContent = `${formatResult(result)} ${toLabel}`;
  } catch (err) {
    // A representable number can still be physically out of range (e.g. below
    // absolute zero) or overflow; surface the converter's message.
    clearResult(err instanceof RangeError ? err.message : 'Invalid input.');
  }
}

/**
 * Map a parser failure reason to a short, human-readable status message.
 *
 * @param {string} reason
 * @returns {string}
 */
function reasonMessage(reason) {
  switch (reason) {
    case 'number is too large':
      return 'That number is too large.';
    case 'number is too small':
      return 'That number is too small to represent.';
    default:
      return 'Please enter a valid number.';
  }
}

function onSwap() {
  const from = fromSelect.value;
  fromSelect.value = toSelect.value;
  toSelect.value = from;
  update();
  valueInput.focus();
}

/**
 * Submit the form without triggering navigation or a page reload. The value
 * input is the default focus when the form is submitted with Enter, so we just
 * prevent the default GET/POST and let the existing live-update logic refresh
 * the result (which also keeps the URL unchanged).
 */
function onSubmit(event) {
  event.preventDefault();
  update();
  valueInput.focus();
}

// Initial state: Length, meters -> feet, empty input.
categorySelect.value = 'length';
populateUnitSelects();
fromSelect.value = 'meters';
toSelect.value = 'feet';
setAriaInvalid(false);
clearResult('');

form.addEventListener('submit', onSubmit);
categorySelect.addEventListener('change', () => {
  populateUnitSelects();
  update();
});
fromSelect.addEventListener('change', update);
toSelect.addEventListener('change', update);
valueInput.addEventListener('input', update);
swapButton.addEventListener('click', onSwap);
