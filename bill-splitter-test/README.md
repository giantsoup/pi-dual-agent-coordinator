# Tip Calculator & Bill Splitter

A dependency-free, responsive tip calculator and bill splitter built with plain
HTML, CSS, and ES modules. All money math uses integer cents and all percentage
rates use integer hundredths of a percent; no floating-point currency arithmetic
is performed. Half-cent tips round upward and extra remainder cents are assigned
to the earliest shares.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Accessible form markup with a polite results live region. |
| `styles.css` | Dependency-free responsive styling (usable at 320px). |
| `app.mjs` | UI wiring: validation, error display, reset, and result rendering. |
| `calculator.mjs` | Pure parsing and calculation module. |
| `calculator.test.mjs` | Node built-in test runner tests. |

## Run the tests

From this directory, with no dependencies installed:

```
node --test calculator.test.mjs
```

## Run the app

From this directory, start a static server on loopback:

```
python3 -m http.server 4173 --bind 127.0.0.1
```

Then open <http://127.0.0.1:4173> in a browser.

## Usage

- **Bill amount** — required. `$0.00` to `$1,000,000.00`. Digits with an
  optional decimal point and up to two fractional digits. Blank clears results.
- **Tip percentage** — required. `0` to `100`, up to two fractional digits
  (e.g. `8.25`). Defaults to `15`.
- **Number of people** — required. Whole number from `1` to `50`. Defaults to `2`.

Submit with the **Calculate** button or **Enter**. **Reset** restores the
defaults, clears errors and results, and focuses the bill field. Whitespace is trimmed; negatives, malformed decimals, extra fractional digits,
exponent/hex notation, currency/grouping characters, `NaN`, and `Infinity` are
rejected with a field-specific error.

## Behavior notes

- For a given bill, tip, and headcount the displayed tip, total, and shares
  always sum exactly; e.g. `$100.00` at `15%` split `3` ways shows a `$15.00`
  tip, `$115.00` total, and shares `$38.34`, `$38.33`, `$38.33`.
- The maximum inputs (`$1,000,000.00` at `100%` split `50` ways) stay within
  safe integer range.
