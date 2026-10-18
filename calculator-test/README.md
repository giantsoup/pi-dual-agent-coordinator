# Calculator

A polished, dependency-free calculator built with native browser JavaScript modules. No frameworks, build tools, CDNs, or external assets required.

## Features

- **Pure arithmetic module** (`calculator.mjs`) - DOM-free, testable calculations
- **Responsive dark UI** with accessible buttons (44px+ touch targets)
- **Full keyboard support** - digits, operators, Enter/= for equals, Escape/Backspace
- **Accurate decimal handling** - `0.1 + 0.2 = 0.3` (no floating-point artifacts)
- **Chain evaluation** - left-to-right operations without PEMDAS
- **Error recovery** - division by zero displays recoverable error message

## Files

| File | Description |
|------|-------------|
| `index.html` | Main HTML structure with semantic markup |
| `styles.css` | Responsive dark theme, system fonts, accessibility |
| `app.js` | UI controller - DOM handling and event wiring |
| `calculator.mjs` | Core arithmetic module with export functions |
| `calculator-state.mjs` | DOM-free state management for testing and separation |
| `calculator.test.mjs` | Node.js test suite for arithmetic operations |

## Launch Instructions

### Start the HTTP server

```bash
python3 -m http.server 8080 --directory calculator-test
```

### Open in browser

Navigate to: http://localhost:8080

### Run tests

```bash
node calculator-test/calculator.test.mjs
```

## Manual Checks

### Arithmetic Operations

1. Test addition: `2 + 3 =` → should display `5`
2. Test subtraction: `10 - 4 =` → should display `6`
3. Test multiplication: `6 * 7 =` → should display `42`
4. Test division: `20 / 5 =` → should display `4`

### Decimal Accuracy

1. Enter: `0.1 + 0.2 =` → should display `0.3` (not `0.30000000000000004`)
2. Enter: `1.5 + 2.7 =` → should display `4.2`

### Chain Evaluation

1. Enter: `2 + 3 * 4 =` → should display `20` (left-to-right: (2+3)*4)
   - Note: This is intentional left-to-right chaining, not PEMDas precedence

### Error Recovery

1. Enter: `5 / 0 =` → should display "Division by zero is not allowed"
2. Press `AC` or Enter a new number → calculator should be usable again
3. Enter: `10 + 2 =` after error → should display `12`

### Keyboard Controls

| Key | Action |
|-----|--------|
| Digits `0-9` | Enter numbers |
| `.` | Decimal point |
| `+`, `-`, `*`, `/` | Select operation |
| `Enter` or `=` | Calculate result |
| `Escape`, `c`, `C` | All clear (AC) |
| `Backspace` | Delete last digit |

### Mobile/Narrow Layout

1. Resize browser to ~320px width or use mobile view
2. Verify buttons are accessible (44px+ height)
3. Test touch input with tap gestures
4. Verify display is readable at smaller sizes

### Negative Numbers

1. Enter: `5 + (-3) =` → should display `2`
2. Use sign toggle on displayed number

### Backspace and Clear

1. Enter a number, press `⌫` → last digit removed
2. Press `C` → resets to 0 but keeps pending operations
3. Press `AC` → complete reset

## API Reference (calculator.mjs)

### `formatResult(value)`

Formats a numeric result to avoid floating-point artifacts.

```javascript
import { formatResult } from './calculator.mjs';
formatResult(0.1 + 0.2); // "0.3"
```

### `calculate(left, operator, right)`

Performs a single arithmetic operation.

```javascript
import { calculate } from './calculator.mjs';
calculate(2, '+', 3); // "5"
calculate(10, '/', 0); // Throws: Division by zero is not allowed
```

### `evaluateChain(numbers, operators)`

Evaluates left-to-right chain of operations.

```javascript
import { evaluateChain } from './calculator.mjs';
evaluateChain([2, 3, 4], ['+', '*']); // "20" (computes (2+3)*4)
```

## Accessibility

- Semantic HTML with ARIA labels
- Keyboard navigation support
- Focus visible indicators
- High contrast mode support
- Reduced motion preference support

## Browser Support

- Chrome/Edge (latest)
- Firefox (latest)
- Safari (latest)
- Any browser supporting ES modules

## License

MIT
