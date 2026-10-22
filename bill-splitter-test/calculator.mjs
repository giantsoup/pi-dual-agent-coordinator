/**
 * Dependency-free tip calculator and bill splitter.
 *
 * All money math is done in integer cents and all percentage rates in integer
 * hundredths of a percent. No floating-point currency arithmetic is used.
 *
 * Parsing functions take a raw string and return either a value object
 * `{ ok: true, value }` or an error object `{ ok: false, error }`.
 * - parseBill:   integer cents, 0..100_000_000 ($0.00 to $1,000,000.00)
 * - parseTip:    integer hundredths of a percent, 0..10_000 (0% to 100%)
 * - parsePeople: integer, 1..50
 *
 * computeSplit({ billCents, tipHundredths, people }) returns
 *   { tipCents, totalCents, shares: number[] (integer cents, sums to totalCents) }
 * Half-cent tips round upward. Extra remainder cents are assigned to the
 * earliest shares.
 *
 * formatCents(cents) returns a string like "115.00" (no currency symbol).
 */

const BILL_MAX_CENTS = 100_000_000; // $1,000,000.00
const TIP_MAX_HUNDREDTHS = 10_000; // 100.00%
const PEOPLE_MAX = 50;

const BILL_RE = /^(\d+)(?:\.(\d{1,2}))?$/;
const TIP_RE = /^(\d+)(?:\.(\d{1,2}))?$/;
const PEOPLE_RE = /^(\d+)$/;

/**
 * @param {string} raw
 * @returns {{ok:true,value:number}|{ok:false,error:string}}
 */
export function parseBill(raw) {
  if (typeof raw !== "string") {
    return { ok: false, error: "Bill must be a number." };
  }
  const trimmed = raw.trim();
  if (trimmed === "") return { ok: false, error: "empty" };
  const match = BILL_RE.exec(trimmed);
  if (!match) {
    return {
      ok: false,
      error:
        "Enter the bill as digits with up to two digits after the decimal point.",
    };
  }
  const whole = match[1];
  const frac = match[2] ?? "";
  if (whole.length > 12) {
    return { ok: false, error: "Bill is too large (maximum is $1,000,000.00)." };
  }
  const cents = BigInt(whole) * 100n + BigInt(frac.padEnd(2, "0"));
  if (cents > BigInt(BILL_MAX_CENTS)) {
    return { ok: false, error: "Bill is too large (maximum is $1,000,000.00)." };
  }
  return { ok: true, value: Number(cents) };
}

/**
 * @param {string} raw
 * @returns {{ok:true,value:number}|{ok:false,error:string}}
 */
export function parseTip(raw) {
  if (typeof raw !== "string") {
    return { ok: false, error: "Tip must be a number." };
  }
  const trimmed = raw.trim();
  if (trimmed === "") return { ok: false, error: "empty" };
  const match = TIP_RE.exec(trimmed);
  if (!match) {
    return {
      ok: false,
      error: "Enter the tip as a percentage with up to two digits after the decimal point.",
    };
  }
  const whole = match[1];
  const frac = match[2] ?? "";
  if (whole.length > 4) {
    return { ok: false, error: "Tip must be between 0 and 100%." };
  }
  const hundredths = BigInt(whole) * 100n + BigInt(frac.padEnd(2, "0"));
  if (hundredths > BigInt(TIP_MAX_HUNDREDTHS)) {
    return { ok: false, error: "Tip must be between 0 and 100%." };
  }
  return { ok: true, value: Number(hundredths) };
}

/**
 * @param {string} raw
 * @returns {{ok:true,value:number}|{ok:false,error:string}}
 */
export function parsePeople(raw) {
  if (typeof raw !== "string") {
    return { ok: false, error: "People must be a whole number." };
  }
  const trimmed = raw.trim();
  if (trimmed === "") return { ok: false, error: "empty" };
  const match = PEOPLE_RE.exec(trimmed);
  if (!match) {
    return { ok: false, error: "Enter a whole number of people." };
  }
  const value = Number(trimmed);
  if (!Number.isSafeInteger(value) || value < 1 || value > PEOPLE_MAX) {
    return { ok: false, error: "People must be a whole number from 1 to 50." };
  }
  return { ok: true, value };
}

/**
 * @param {{billCents:number, tipHundredths:number, people:number}} input
 * @returns {{tipCents:number,totalCents:number,shares:number[]}}
 */
export function computeSplit({ billCents, tipHundredths, people }) {
  // billCents <= 100,000,000 and tipHundredths <= 10,000, so the product is at
  // most 1e12, well within safe integer range. The +5000 / 10000 gives
  // half-up rounding of the half-cent tip.
  const tipCents = Math.floor((billCents * tipHundredths + 5000) / 10000);
  const totalCents = billCents + tipCents;
  const base = Math.floor(totalCents / people);
  const remainder = totalCents - base * people;
  const shares = [];
  for (let i = 0; i < people; i += 1) {
    shares.push(base + (i < remainder ? 1 : 0));
  }
  return { tipCents, totalCents, shares };
}

/**
 * Format integer cents as a decimal string with exactly two fractional digits.
 * @param {number} cents
 * @returns {string}
 */
export function formatCents(cents) {
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100);
  const frac = String(abs % 100).padStart(2, "0");
  return `${negative ? "-" : ""}${whole}.${frac}`;
}
