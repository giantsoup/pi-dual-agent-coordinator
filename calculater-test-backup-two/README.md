# Calculator

A standalone, accessible calculator built with vanilla HTML, CSS, and JavaScript. No dependencies, no frameworks, no build tools.

## Files

| File | Purpose |
|------|---------|
| `index.html` | Semantic markup for the calculator UI |
| `styles.css` | Responsive dark theme with focus-visible and touch states |
| `calculator.js` | Pure arithmetic engine (no DOM) |
| `app.js` | DOM wiring — buttons, keyboard input, display updates |
| `tests/calculator.test.js` | Node built-in test runner tests for the arithmetic module |

## Launching the page

Open a terminal in this directory and run:

```bash
python3 -m http.server 8000 --directory .
```

Then open <http://localhost:8000> in your browser.

Alternatively, open `index.html` directly in a browser (file:// protocol). Note that ES module imports may be blocked by some browsers when loading from `file://`; the HTTP server approach is recommended.

## Manual checks

1. **Basic arithmetic** — Enter `2 + 3 × 4` and press `=`. The result should be `20` (left-to-right evaluation, not operator precedence).
2. **Decimal precision** — Enter `0.1 + 0.2` and press `=`. The display should show `0.3`.
3. **Duplicate decimal** — Type `1.2.3`. Only the first decimal point is accepted; the second is ignored.
4. **Negative numbers** — Press `±` to toggle the sign of the current operand.
5. **Division by zero** — Enter `5 ÷ 0 =`. The display shows "Division by zero". Then press `AC` and start a new calculation — it should work normally (recoverable error).
6. **Keyboard input** — Use number keys, `+`, `-`, `*`, `/`, `Enter` (=), `Escape` (clear), and `Backspace` (delete last character).
7. **Accessibility** — Tab through buttons; each button has a visible focus ring. Screen-reader labels are provided via `aria-label`.

## Running the tests

```bash
node --test calculator-test/tests/calculator.test.js
```

All tests should pass with zero failures.
