import { CATEGORIES, convert } from './converter.mjs';

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

function clearResult(message) {
  resultOutput.textContent = '';
  statusEl.textContent = message ?? '';
  statusEl.classList.toggle('error', Boolean(message));
}

function update() {
  const raw = valueInput.value.trim();

  if (raw === '') {
    clearResult('');
    return;
  }

  let value;
  try {
    value = Number(raw);
  } catch {
    value = NaN;
  }

  if (!Number.isFinite(value)) {
    clearResult('Please enter a valid number.');
    return;
  }

  try {
    const result = convert(value, categorySelect.value, fromSelect.value, toSelect.value);
    clearResult('');
    const toLabel = CATEGORIES[categorySelect.value].units[toSelect.value].label;
    resultOutput.textContent = `${formatResult(result)} ${toLabel}`;
  } catch (err) {
    clearResult(err instanceof RangeError ? err.message : 'Invalid input.');
  }
}

function onSwap() {
  const from = fromSelect.value;
  fromSelect.value = toSelect.value;
  toSelect.value = from;
  update();
  valueInput.focus();
}

// Initial state: Length, meters -> feet, empty input.
categorySelect.value = 'length';
populateUnitSelects();
fromSelect.value = 'meters';
toSelect.value = 'feet';
clearResult('');

categorySelect.addEventListener('change', () => {
  populateUnitSelects();
  update();
});
fromSelect.addEventListener('change', update);
toSelect.addEventListener('change', update);
valueInput.addEventListener('input', update);
swapButton.addEventListener('click', onSwap);
