import {
  parseBill,
  parseTip,
  parsePeople,
  computeSplit,
  formatCents,
} from "./calculator.mjs";

const form = document.getElementById("split-form");
const billInput = document.getElementById("bill");
const tipInput = document.getElementById("tip");
const peopleInput = document.getElementById("people");
const resultsSection = document.getElementById("results");
const resultTip = document.getElementById("result-tip");
const resultTotal = document.getElementById("result-total");
const resultShares = document.getElementById("result-shares");

const DEFAULTS = { bill: "", tip: "15", people: "2" };

function clearError(input) {
  const error = document.getElementById(`${input.id}-error`);
  error.textContent = "";
  error.hidden = true;
  input.setAttribute("aria-invalid", "false");
}

function setError(input, message) {
  const error = document.getElementById(`${input.id}-error`);
  error.textContent = message;
  error.hidden = false;
  input.setAttribute("aria-invalid", "true");
}

function clearResults() {
  resultsSection.hidden = true;
  resultTip.textContent = "";
  resultTotal.textContent = "";
  resultShares.textContent = "";
}

function validate(input, parser) {
  const raw = input.value;
  clearError(input);
  if (raw.trim() === "") return null; // blank: no error, no value
  const parsed = parser(raw);
  if (!parsed.ok) {
    setError(input, parsed.error);
    return null;
  }
  return parsed.value;
}

function renderResults({ tipCents, totalCents, shares }) {
  resultTip.textContent = `$${formatCents(tipCents)}`;
  resultTotal.textContent = `$${formatCents(totalCents)}`;
  resultShares.textContent = "";
  shares.forEach((shareCents, i) => {
    const li = document.createElement("li");
    li.textContent = `Person ${i + 1}: $${formatCents(shareCents)}`;
    resultShares.appendChild(li);
  });
  resultsSection.hidden = false;
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  clearResults();

  const billCents = validate(billInput, parseBill);
  const tipHundredths = validate(tipInput, parseTip);
  const people = validate(peopleInput, parsePeople);

  if (billCents === null || tipHundredths === null || people === null) {
    return;
  }

  renderResults(computeSplit({ billCents, tipHundredths, people }));
});

form.addEventListener("reset", () => {
  // Reset fires after the browser has restored default values; clear
  // validation state and results, then focus the bill field.
  requestAnimationFrame(() => {
    [billInput, tipInput, peopleInput].forEach(clearError);
    clearResults();
    billInput.focus();
  });
});
