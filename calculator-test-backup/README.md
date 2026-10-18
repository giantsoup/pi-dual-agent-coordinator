# Calculator Web Project

A polished, dependency-free calculator built with vanilla HTML, CSS, and JavaScript.

## Quick Start

### Launch in a browser (required: local HTTP server)

The app uses ES module imports (`import ... from './calculator.mjs'`), which require an HTTP server context — opening `index.html` directly via `file://` will fail. Serve it locally:

```bash
# Python 3
python3 -m http.server 8080 --directory calculator-test/
# Then open: http://localhost:8080/index.html
```

### Run tests (Node.js)

No dependencies required — just run the test file directly:

```bash
node calculator-test/calculator.test.mjs
```

## Features

- **Four basic operations**: addition, subtraction, multiplication, division
- **Decimal support** with duplicate-decimal prevention
- **Negative numbers** via the ± toggle button
- **Left-to-right chained evaluation** (no operator precedence — e.g. `2 + 3 * 4 = 20`)
- **Division by zero** shows a recoverable error message
- **Floating-point fix**: `0.1 + 0.2` displays as `0.3` (not `0.30000000000000004`)

## Keyboard Controls

| Key | Action |
|-----|--------|
| `0-9` | Enter digits |
| `.` | Decimal point |
| `+`, `-`, `*`, `/` | Operators |
| `Enter` or `=` | Evaluate expression |
| `Escape` | Clear all (AC) |
| `Backspace` | Delete last digit |

## Manual Checks

After launching the calculator, verify:

1. **Basic arithmetic**: Type `2 + 3 =`, result should be `5`.
2. **Decimal precision**: Type `0.1 + 0.2 =`, result should be `0.3` (not a floating-point artifact).
3. **Chaining**: Type `2 + 3 * 4 =`, result should be `20` (left-to-right: `(2+3)*4`). The expression display shows all entered operands and operators.
4. **Division by zero**: Type `5 / 0 =`, display shows "Error". Press AC to recover and continue using the calculator.
5. **Chaining from result**: Type `5 = + 3 =`, result should be `8`. The operand after `+` starts fresh (does not append to the displayed result).
6. **Backspace**: After typing a number, press Backspace or ⌫ button to delete the last digit.
7. **Clear**: Press Escape key or AC button at any time to reset.
8. **Negative numbers**: Type `5`, then press ± to get `-5`.
9. **Keyboard input**: All operations work via keyboard (see table above).
10. **Touch targets**: On mobile, all buttons are at least 46px tall for comfortable tapping.
11. **Responsive layout**: Resize the browser window — the calculator adapts gracefully down to ~320px width.
12. **Visible focus**: Click or tab into a button — it should show an orange outline (`outline: 3px solid #e94560`).

## Project Structure

```
calculator-test/
├── index.html            # Semantic HTML interface (loads app.js as ES module)
├── styles.css            # Responsive dark theme styling
├── app.js                # DOM-facing calculator logic (mouse/touch/keyboard)
├── calculator-state.mjs  # Shared input/state-transition logic (UI + tests)
├── calculator.mjs        # Pure arithmetic module (no DOM, no eval())
├── calculator.test.mjs   # Dependency-free arithmetic and state tests
└── README.md             # This file
```

## Design Decisions

- **No `eval()` or `Function()`**: All arithmetic is implemented with explicit switch-case operations.
- **Separation of concerns**: `calculator.mjs` handles pure math; `calculator-state.mjs` handles input/state transitions; `app.js` handles DOM and user input.
- **Shared state module**: `calculator-state.mjs` is imported by both the UI (`app.js`) and tests (`calculator.test.mjs`), ensuring they exercise identical production logic.
- **Zero dependencies**: No build tools, no package.json, no npm install needed.
- **ES modules for browser and tests**: Both app.js and calculator.test.mjs use native ES module imports (`import ... from './...'`).
