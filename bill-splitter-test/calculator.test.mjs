import test from "node:test";
import assert from "node:assert/strict";

import {
  parseBill,
  parseTip,
  parsePeople,
  computeSplit,
  formatCents,
} from "./calculator.mjs";

test("parseBill parses decimal strings to integer cents without floating point", () => {
  assert.deepEqual(parseBill("100.00"), { ok: true, value: 10000 });
  assert.deepEqual(parseBill("0.00"), { ok: true, value: 0 });
  assert.deepEqual(parseBill("0"), { ok: true, value: 0 });
  assert.deepEqual(parseBill("10"), { ok: true, value: 1000 });
  assert.deepEqual(parseBill("10.5"), { ok: true, value: 1050 });
  assert.deepEqual(parseBill("10.05"), { ok: true, value: 1005 });
  assert.deepEqual(parseBill("10.50"), { ok: true, value: 1050 });
  assert.deepEqual(parseBill("1,000,000.00"), { ok: false, error: "Enter the bill as digits with up to two digits after the decimal point." });
  // 0.1 is exact in cents even though it is not in binary floating point.
  assert.deepEqual(parseBill("0.1"), { ok: true, value: 10 });
  assert.deepEqual(parseBill("0.29"), { ok: true, value: 29 });
});

test("parseBill trims surrounding whitespace", () => {
  assert.deepEqual(parseBill("  12.34  "), { ok: true, value: 1234 });
});

test("parseBill boundary values", () => {
  assert.deepEqual(parseBill("0"), { ok: true, value: 0 });
  assert.deepEqual(parseBill("1000000.00"), { ok: true, value: 100000000 });
});

test("parseBill rejects invalid and out-of-range values", () => {
  const invalid = [
    "-1.00",
    "1.234",
    "1.2345",
    "..5",
    ".",
    "5.",
    "1.2.3",
    "abc",
    "1e3",
    "0x10",
    "$5",
    "1,000",
    "NaN",
    "Infinity",
    "-Infinity",
    "+5",
    "1000000.01",
    "10000001",
    "  ",
  ];
  for (const raw of invalid) {
    const result = parseBill(raw);
    assert.equal(result.ok, false, `expected invalid for ${JSON.stringify(raw)}`);
  }
});

test("parseTip parses percentages to integer hundredths", () => {
  assert.deepEqual(parseTip("15"), { ok: true, value: 1500 });
  assert.deepEqual(parseTip("15.00"), { ok: true, value: 1500 });
  assert.deepEqual(parseTip("8.25"), { ok: true, value: 825 });
  assert.deepEqual(parseTip("0"), { ok: true, value: 0 });
  assert.deepEqual(parseTip("100"), { ok: true, value: 10000 });
  assert.deepEqual(parseTip("0.5"), { ok: true, value: 50 });
  assert.deepEqual(parseTip(" 50 "), { ok: true, value: 5000 });
});

test("parseTip rejects invalid and out-of-range values", () => {
  const invalid = [
    "-1",
    "100.01",
    "101",
    "8.255",
    "abc",
    "50%",
    "1e2",
    "NaN",
    "Infinity",
    "  ",
    ".",
  ];
  for (const raw of invalid) {
    const result = parseTip(raw);
    assert.equal(result.ok, false, `expected invalid for ${JSON.stringify(raw)}`);
  }
});

test("parsePeople accepts integers 1-50 and rejects anything else", () => {
  assert.deepEqual(parsePeople("1"), { ok: true, value: 1 });
  assert.deepEqual(parsePeople("2"), { ok: true, value: 2 });
  assert.deepEqual(parsePeople("50"), { ok: true, value: 50 });
  assert.deepEqual(parsePeople(" 3 "), { ok: true, value: 3 });
  for (const raw of ["0", "51", "1.0", "-2", "abc", "1e1", "  ", ".", "NaN", "Infinity"]) {
    const result = parsePeople(raw);
    assert.equal(result.ok, false, `expected invalid for ${JSON.stringify(raw)}`);
  }
});

test("tip rounding rounds half cents upward", () => {
  // $0.01 at 50% = 0.005 cents of tip, which rounds up to 1 cent.
  const { tipCents } = computeSplit({ billCents: 1, tipHundredths: 5000, people: 3 });
  assert.equal(tipCents, 1);
  // $10.00 at 8.25% = 825 hundredths * 1000 cents = 82500 / 10000 = 8.25 -> floor 8.25? No:
  // (1000 * 825 + 5000) / 10000 = 825000 + 5000 = 830000 / 10000 = 83 exactly.
  assert.equal(computeSplit({ billCents: 1000, tipHundredths: 825, people: 4 }).tipCents, 83);
  // $3.33 at 15%: (333*1500+5000)/10000 = (499500+5000)/10000 = 50.45 -> 50 cents (floor)
  assert.equal(computeSplit({ billCents: 333, tipHundredths: 1500, people: 1 }).tipCents, 50);
  // Exactly-half case: billCents * tipHundredths mod 10000 == 5000 rounds up.
  // 25 cents * 2000 hundredths (20%) = 50000 / 10000 = 5 exactly, no rounding needed.
  // Try 125 * 400 (4%) = 50000 -> 5 exactly.
  // Half case: bill=12.5? Not possible. bill=5, tip=10% (1000): 5*1000=5000 -> +5000=10000 -> 1.
  // So 5 cents at 10% rounds to 1 cent (half up), not 0.
  assert.equal(computeSplit({ billCents: 5, tipHundredths: 1000, people: 1 }).tipCents, 1);
  // 15 cents at 10%: 15000+5000=20000/10000=2 (exact, 1.5 rounds to 2).
  assert.equal(computeSplit({ billCents: 15, tipHundredths: 1000, people: 1 }).tipCents, 2);
  // 25 cents at 20%: 50000+5000=55000/10000=5 (exact 5.0 stays 5).
  assert.equal(computeSplit({ billCents: 25, tipHundredths: 2000, people: 1 }).tipCents, 5);
});

test("remainder distribution assigns extra cents to the earliest shares", () => {
  const { shares } = computeSplit({ billCents: 1000, tipHundredths: 0, people: 3 });
  assert.deepEqual(shares, [334, 333, 333]);
  const sum = shares.reduce((a, b) => a + b, 0);
  assert.equal(sum, 1000);
  // 7 cents among 3: 2, 2, 3? No: base = 2, remainder = 1 -> [3, 2, 2].
  assert.deepEqual(computeSplit({ billCents: 7, tipHundredths: 0, people: 3 }).shares, [3, 2, 2]);
  // Even split.
  assert.deepEqual(computeSplit({ billCents: 1000, tipHundredths: 0, people: 4 }).shares, [250, 250, 250, 250]);
});

test("required example: $100.00 at 15% split 3 ways", () => {
  const bill = parseBill("100.00");
  const tip = parseTip("15");
  const people = parsePeople("3");
  assert.ok(bill.ok && tip.ok && people.ok);
  const result = computeSplit({
    billCents: bill.value,
    tipHundredths: tip.value,
    people: people.value,
  });
  assert.equal(formatCents(result.tipCents), "15.00");
  assert.equal(formatCents(result.totalCents), "115.00");
  assert.deepEqual(result.shares.map(formatCents), ["38.34", "38.33", "38.33"]);
});

test("required example: $10.00 at 8.25% split 4 ways", () => {
  const result = computeSplit({
    billCents: parseBill("10.00").value,
    tipHundredths: parseTip("8.25").value,
    people: parsePeople("4").value,
  });
  assert.equal(formatCents(result.tipCents), "0.83");
  assert.equal(formatCents(result.totalCents), "10.83");
  assert.deepEqual(result.shares.map(formatCents), ["2.71", "2.71", "2.71", "2.70"]);
});

test("required example: $0.01 at 50% split 3 ways", () => {
  const result = computeSplit({
    billCents: parseBill("0.01").value,
    tipHundredths: parseTip("50").value,
    people: parsePeople("3").value,
  });
  assert.equal(formatCents(result.tipCents), "0.01");
  assert.equal(formatCents(result.totalCents), "0.02");
  assert.deepEqual(result.shares.map(formatCents), ["0.01", "0.01", "0.00"]);
});

test("formatCents formats integer cents", () => {
  assert.equal(formatCents(0), "0.00");
  assert.equal(formatCents(1), "0.01");
  assert.equal(formatCents(5), "0.05");
  assert.equal(formatCents(100), "1.00");
  assert.equal(formatCents(1005), "10.05");
  assert.equal(formatCents(11500), "115.00");
  assert.equal(formatCents(100000000), "1000000.00");
});

test("largest inputs stay within safe integer bounds", () => {
  const result = computeSplit({
    billCents: 100000000,
    tipHundredths: 10000,
    people: 50,
  });
  assert.equal(result.tipCents, 100000000);
  assert.equal(result.totalCents, 200000000);
  assert.deepEqual(result.shares, Array(50).fill(4000000));
});
