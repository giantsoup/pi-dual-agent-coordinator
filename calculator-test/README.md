# Calculator

A self-contained, accessible calculator built with **vanilla HTML, CSS, and
JavaScript**. No frameworks, no dependencies, no build tools, no CDNs, no
external assets.

## Files

| File | Purpose |
|------|---------|
| `index.html` | Semantic page markup with native buttons and a live display |
| `styles.css` | Mobile-first dark theme, high contrast, responsive grid, visible focus |
| `arithmetic.js` | DOM-independent arithmetic engine (ES module, no `eval`/`Function`) |
| `app.js` | UI controller: wires buttons and keyboard to `calculate()` |
| `arithmetic.test.js` | Dependency-free `node:test` suite for the arithmetic engine |

## Launch

The app uses an ES module (`app.js` imports `arithmetic.js`), so serve the
folder over HTTP instead of opening `index.html` directly via `file://`:

```bash
cd calculator-test
python3 -m http.server 8000
```

Then open **http://localhost:8000** in a browser.

Stop the server with `Ctrl+C`.

## Tests

Run the dependency-free arithmetic test suite from the repository root:

```bash
node --test calculator-test/arithmetic.test.js
```

All tests use only Node's built-in `node:test` and `node:assert/strict`
modules — no test framework or packages are required.

## Controls

### Keypad

| Key | Action |
|-----|--------|
| `0`–`9` | Enter digits |
| `.` | Decimal point (duplicate points are ignored) |
| `+` `−` `×` `÷` | Add, subtract, multiply, divide |
| `=` | Evaluate (left-to-right) |
| `AC` | Clear everything |
| `±` | Toggle the sign of the current entry |
| `⌫` | Delete the last character of the current entry |

### Keyboard

| Key | Action |
|-----|--------|
| `0`–`9` | Enter digits |
| `.` or `,` | Decimal point |
| `+` `-` `*` `/` | Operators |
| `Enter` or `=` | Evaluate |
| `Escape` | Clear all |
| `Backspace` | Delete last character |

### Behavior

- **Left-to-right evaluation** with no operator precedence: `2 + 3 × 4 =` **20**.
- **Decimal normalization**: `0.1 + 0.2 =` **0.3**.
- **Division by zero** shows **Error**; press `AC` (or `Escape`) or type any
digit to recover.
- **Chained operations**: results carry forward, e.g. `2 + 3 =` **5**, then
`× 4 =` **20**.
- **Negative numbers** via `±` or by typing a subtraction that goes negative.

## Manual checks

1. `0.1 + 0.2 =` → displays **0.3**
2. `2 + 3 × 4 =` → displays **20** (left-to-right, no precedence)
3. `5 ÷ 0 =` → displays **Error**; press `AC` or type a digit to recover
4. Type `1 . . 2` → the second `.` is ignored, display shows **1.2**
5. `5 − 8 =` → displays **−3**; `±` toggles the sign of the entry
6. `⌫` / `Backspace` deletes the last character of the current entry
7. Tab through buttons → a visible focus ring appears on each
8. Resize the browser to a narrow (mobile) width → the layout stays usable

## Accessibility

- Semantic HTML: `<main>`, `<section>`, native `<button>` elements
- Live display uses `role="status"` / `aria-live="polite"`
- Every button has a descriptive `aria-label`
- Visible keyboard focus (`:focus-visible` with a 3 px outline)
- High-contrast color palette (WCAG AA)
- Touch targets ≥ 56 px
- `prefers-reduced-motion` respected
