# Unit Converter

A dependency-free unit converter. Plain HTML, CSS, and JavaScript — no
third-party dependencies and no build step. Conversion math lives in
`converter.mjs` (full precision, no rounding); `app.js` handles the UI and
rounds only when displaying a result.

## Features

- **Length** — meters, kilometers, centimeters, feet, inches
- **Mass** — kilograms, grams, pounds, ounces
- **Temperature** — Celsius, Fahrenheit, Kelvin

The result updates as you type or change a unit. The **Swap** button exchanges
the from/to units without changing the entered value. Empty or invalid input
clears the previous result and shows a status. Negative length/mass and
temperatures below absolute zero are rejected, and non-finite values never
display `NaN` or `Infinity`.

## Run locally

Serve the folder from this directory, then open the printed URL:

```sh
python3 -m http.server 8000
```

Open <http://localhost:8000>.

## Run the tests

The tests use Node's built-in test runner (no dependencies):

```sh
node --test converter.test.mjs
```

They cover known conversions, temperature offsets and absolute-zero
boundaries, same-unit conversions, floating-point round trips, and invalid
inputs/ranges.
