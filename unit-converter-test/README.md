# Unit Converter

A dependency-free unit converter. Plain HTML, CSS, and JavaScript — no
third-party dependencies and no build step. Conversion math lives in
`converter.mjs` (full precision, no rounding); `numeric-input.mjs` parses the
value field; `app.js` handles the UI and rounds only when displaying a result.

## Features

- **Length** — meters, kilometers, centimeters, feet, inches
- **Mass** — kilograms, grams, pounds, ounces
- **Temperature** — Celsius, Fahrenheit, Kelvin

The result updates as you type or change a unit. The **Swap** button exchanges
the from/to units without changing the entered value and returns focus to the
value field. Empty or invalid input clears the previous result and shows a
status message. Submitting the form (Enter) converts without navigating.

## Accepted numeric syntax

The value field accepts **only** a trimmed, optional signed decimal or
scientific-notation number — never hexadecimal, binary, octal, `NaN`, or the
`Infinity` literals that `Number()` would otherwise accept.

Accepted:

- Plain and signed decimals: `42`, `-7`, `+7`, `3.14`, `-1.5`
- Leading-fraction and trailing-dot forms: `.5`, `5.`, `-.25`
- Scientific notation with signed exponents: `1e3`, `1E3`, `1e-3`, `1.5e+2`, `.5e2`
- Leading zeros as ordinary decimals: `010` → 10 (not octal)
- Surrounding whitespace: `  42  `, `\t-1.5\n`
- Zero literals: `0`, `0.0`, `-0`, `0e-9999` (the significand is zero, so the
  value really is zero)

Rejected:

- Malformed text: `abc`, `1.2.3`, `--5`, `1e`, `1e+`, `.`, `+`, `1 2`, `1,000`
- Non-decimal notation: `0x10`, `0X10`, `0b101`, `0o17`, `0x`, `0b`, `0o`
- `NaN` and `Infinity` literals (`Infinity`, `-Infinity`, `inf`, …)
- **Overflow**: a literal whose value exceeds the numeric range, e.g. `1e400`
  or `1e309` → status “That number is too large.”
- **Nonzero underflow**: a nonzero literal that collapses to `0`, e.g.
  `1e-9999` or `0.5e-1000` → status “That number is too small to represent.”
  (The zero literals above are still valid zero.)

Invalid input clears any stale result, sets `aria-invalid="true"` on the value
field, and shows the mapped status message. Empty input is neutral: it clears
the result and the invalid flag without an error.

## Physical range errors

The converter itself throws (and the UI surfaces as status text, with the
result cleared):

- Negative length or mass — “Length/Mass cannot be negative”
- Temperatures below absolute zero in any unit (`-273.15` °C, `-459.67` °F,
  `0` K are the allowed minimums)
- Finite inputs whose conversion overflows the numeric range (e.g. meters →
  inches at `1e308`, Celsius → Fahrenheit at `Number.MAX_VALUE`) — “result of
  … exceeds the range of representable numbers”. Conversions that stay
  representable (e.g. meters → kilometers at `Number.MAX_VALUE`) do not throw.

Unknown or prototype-named category/unit identifiers (`toString`,
`constructor`, `__proto__`, non-strings, …) are rejected with `TypeError`.

## Display rounding

`convert()` computes at full precision and never rounds. Only `app.js`'s
`formatResult()` rounds, at display time: integer values are shown as-is, and
other values are shown with up to 10 significant digits (`toPrecision(10)`,
then re-parsed to strip trailing zeros). Examples: 1 m → `3.280839895 Feet`,
2.54 cm → `100 Centimeters`, 100 kg → `1000000 Grams`.

## Accessibility

- The value input is labelled (“Value”) and carries
  `aria-describedby="status"`, so the status/error text is announced with the
  input. `aria-invalid` is set for invalid values and cleared for empty/valid
  ones.
- The status line is `role="status"` / `aria-live="polite"`; the result is an
  `<output>` with `aria-live="polite"`, so conversions and errors are announced
  as they appear.
- The Swap button shows a visible 2px solid white outline when keyboard-focused
  (`:focus-visible`), distinct from the card background.
- The Swap button label (white) meets WCAG 4.5:1 contrast against both the
  default (`#345fc9`, ≈ 5.79:1) and hover (`#2f56c0`, ≈ 6.54:1) backgrounds.

## Run locally

Serve the folder from this directory, then open the printed URL:

```sh
python3 -m http.server 8000
```

Open <http://localhost:8000>.

## Run the unit tests

The unit tests use Node's built-in test runner (no dependencies):

```sh
cd unit-converter-test
node --test converter.test.mjs numeric-input.test.mjs
# or
npm test
```

They cover known conversions, temperature offsets and absolute-zero
boundaries, same-unit identity (including exact identity at numeric extremes),
floating-point round trips, range rejection, overflow handling, parser
accepted/rejected forms, and prototype-name rejection in the category/from/to
positions.

## Run the browser tests (development only)

Playwright is a **dev-only** dependency of this folder; the converter itself
still runs with no npm installation. From this directory, with the repository
Node (`.nvmrc`) and npm (`packageManager`) active:

```sh
cd unit-converter-test
npm install
npx playwright install chromium
npm run test:browser
```

The manifest pins `@playwright/test` to the exact version `1.49.1`. A
`package-lock.json` is not committed for this folder, so use `npm install` (it
resolves the exact pinned specifiers into a local lockfile); `npm ci` requires
a committed lockfile and is therefore not the documented install command here.

`playwright.config.mjs` serves this folder with a local
`python3 -m http.server 4173 --bind 127.0.0.1` web server and tears it down
after the run. `browser.test.mjs` drives the real served page: initial empty
state, valid conversion, invalid input clearing a stale result and setting
`aria-invalid`, recovery to valid input, category/unit changes, swap preserving
the entered value, and form submission without navigation. It also verifies the
label/`aria-describedby`/live-region associations, the keyboard focus outline on
Swap, and computes the WCAG contrast ratio of the Swap label in default and
hover states from the page's computed styles (asserting ≥ 4.5:1).

Note: these are automated in-browser checks of a single Chromium browser. They
are evidence for the scripted flows and computed-style properties above, not
manual screen-reader testing or cross-browser coverage.
