import { test, expect } from '@playwright/test';

/**
 * Browser checks for the served unit converter page.
 *
 * These tests drive the real page (plain HTML/CSS/JS, no build step) over a
 * local HTTP server started by Playwright. They cover the interaction flows
 * and accessibility properties documented in README.md.
 */

/**
 * Convert a CSS `rgb(r, g, b)` or `rgba(r, g, b, a)` string into `[r, g, b]`.
 * @param {string} color
 * @returns {[number, number, number]}
 */
function parseRgb(color) {
  const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!match) throw new Error(`unrecognized color: ${color}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/**
 * WCAG relative luminance of an sRGB color.
 * @param {[number, number, number]} rgb
 * @returns {number}
 */
function relativeLuminance([r, g, b]) {
  const [rl, gl, bl] = [r, g, b].map((channel) => {
    const v = channel / 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rl + 0.7152 * gl + 0.0722 * bl;
}

/**
 * WCAG contrast ratio between two colors (order-independent, 1..21).
 * @param {[number, number, number]} a
 * @param {[number, number, number]} b
 * @returns {number}
 */
function contrastRatio(a, b) {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Compute the effective (opaque) background behind `selector` by walking the
 * element and its ancestors, honoring background-color alpha compositing, so
 * contrast is measured against what the user actually sees.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} selector
 * @returns {Promise<[number, number, number]>}
 */
async function effectiveBackground(page, selector) {
  const background = await page.evaluate((sel) => {
    /** @param {string} css @returns {[number, number, number]} */
    const parseRgbLocal = (css) => {
      const match = css.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
      if (!match) throw new Error(`unrecognized color: ${css}`);
      return [Number(match[1]), Number(match[2]), Number(match[3])];
    };

    /** @param {string} css @returns {number} */
    const alphaOf = (css) => {
      const match = css.match(/rgba?\([^)]*,\s*(\d*\.?\d+)\)$/);
      if (!match) return css === 'transparent' ? 0 : 1;
      return Number(match[1]);
    };

    /** Composite `over` onto `under` and return the composited `rgb()` string. */
    const composite = (over, under) => {
      const alpha = alphaOf(over);
      if (alpha >= 1) return over;
      if (alpha <= 0) return under;
      const top = parseRgbLocal(over);
      const bottom = parseRgbLocal(under);
      const out = top.map((c, i) => Math.round(c * alpha + bottom[i] * (1 - alpha)));
      return `rgb(${out[0]}, ${out[1]}, ${out[2]})`;
    };

    let under = 'rgb(255, 255, 255)';
    let node = /** @type {Element} */ (document.querySelector(sel));
    while (node) {
      const css = getComputedStyle(node).backgroundColor;
      if (css && css !== 'transparent') {
        under = composite(css, under);
        if (alphaOf(css) >= 1) break;
      }
      node = node.parentElement;
    }
    return parseRgbLocal(under);
  }, selector);
  return background;
}

test.describe('unit converter page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('initial empty state has no result, no error, and no invalid flag', async ({ page }) => {
    await expect(page.locator('#result')).toHaveText('');
    await expect(page.locator('#status')).toHaveText('');
    await expect(page.locator('#status')).not.toHaveClass(/error/);
    await expect(page.locator('#value')).not.toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator('#category')).toHaveValue('length');
    await expect(page.locator('#fromUnit')).toHaveValue('meters');
    await expect(page.locator('#toUnit')).toHaveValue('feet');
    // Unit selects are populated from the category definition.
    const fromOptions = await page.locator('#fromUnit option').allTextContents();
    expect(fromOptions).toEqual(['Meters', 'Kilometers', 'Centimeters', 'Feet', 'Inches']);
  });

  test('valid input converts live and clears the invalid flag', async ({ page }) => {
    const value = page.locator('#value');
    await value.fill('1');
    await expect(page.locator('#result')).toHaveText('3.280839895 Feet');
    await expect(page.locator('#status')).toHaveText('');
    await expect(value).not.toHaveAttribute('aria-invalid', 'true');

    await value.fill('2.54');
    await expect(page.locator('#result')).toHaveText('100 Centimeters');
  });

  test('invalid input clears a stale result and sets aria-invalid', async ({ page }) => {
    const value = page.locator('#value');
    await value.fill('2');
    await expect(page.locator('#result')).toHaveText('6.56167979 Feet');

    await value.fill('abc');
    await expect(page.locator('#result')).toHaveText('');
    await expect(value).toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator('#status')).toHaveText('Please enter a valid number.');
    await expect(page.locator('#status')).toHaveClass(/error/);

    // Overflow: a nonzero literal that is too large to represent.
    await value.fill('1e400');
    await expect(page.locator('#status')).toHaveText('That number is too large.');
    await expect(page.locator('#result')).toHaveText('');

    // Nonzero literal that underflows to zero.
    await value.fill('1e-9999');
    await expect(page.locator('#status')).toHaveText('That number is too small to represent.');
  });

  test('recovery to valid input clears the error and re-converts', async ({ page }) => {
    const value = page.locator('#value');
    await value.fill('abc');
    await expect(value).toHaveAttribute('aria-invalid', 'true');

    await value.fill('3');
    await expect(value).not.toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator('#status')).toHaveText('');
    await expect(page.locator('#status')).not.toHaveClass(/error/);
    await expect(page.locator('#result')).toHaveText('9.842519685 Feet');
  });

  test('category and unit changes update the conversion', async ({ page }) => {
    const value = page.locator('#value');
    await value.fill('100');

    await page.locator('#category').selectOption('temperature');
    const fromOptions = await page.locator('#fromUnit option').allTextContents();
    expect(fromOptions).toEqual(['Celsius', 'Fahrenheit', 'Kelvin']);
    await expect(page.locator('#fromUnit')).toHaveValue('celsius');
    await expect(page.locator('#toUnit')).toHaveValue('fahrenheit');
    await expect(page.locator('#result')).toHaveText('212 Fahrenheit');

    await page.locator('#toUnit').selectOption('kelvin');
    await expect(page.locator('#result')).toHaveText('373.15 Kelvin');

    await page.locator('#category').selectOption('mass');
    await expect(page.locator('#fromUnit')).toHaveValue('kilograms');
    await expect(page.locator('#result')).toHaveText('1000000 Grams');
  });

  test('swap preserves the entered value and exchanges the units', async ({ page }) => {
    const value = page.locator('#value');
    await value.fill('1');
    await expect(page.locator('#result')).toHaveText('3.280839895 Feet');

    await page.locator('#swap').click();
    await expect(page.locator('#value')).toHaveValue('1');
    await expect(page.locator('#fromUnit')).toHaveValue('feet');
    await expect(page.locator('#toUnit')).toHaveValue('meters');
    await expect(page.locator('#result')).toHaveText('0.3048 Meters');
    // Focus returns to the value input after swapping.
    await expect(value).toBeFocused();
  });

  test('form submission converts without navigating', async ({ page }) => {
    const value = page.locator('#value');
    await value.fill('5');
    await value.press('Enter');

    // The URL is unchanged (no navigation, no reload).
    expect(page.url()).toBe('http://127.0.0.1:4173/');
    await expect(page.locator('#result')).toHaveText('16.40419948 Feet');
    await expect(value).toBeFocused();
  });

  test('value input is labelled and described by the status text', async ({ page }) => {
    const value = page.locator('#value');
    await expect(value).toHaveAttribute('aria-describedby', 'status');
    const label = page.locator('label[for="value"]');
    await expect(label).toHaveCount(1);
    await expect(label).toHaveText('Value');
    // The value input references its label element by id.
    await expect(value).toHaveAttribute('id', 'value');
    // The status element is a polite live region announced as status text.
    await expect(page.locator('#status')).toHaveAttribute('role', 'status');
    await expect(page.locator('#status')).toHaveAttribute('aria-live', 'polite');
    // The result is exposed as a polite live region for screen readers.
    await expect(page.locator('#result')).toHaveAttribute('aria-live', 'polite');
  });

  test('swap button is keyboard focusable with a visible focus outline', async ({ page }) => {
    const swap = page.locator('#swap');
    // Reach the swap button through keyboard navigation from the top of the
    // document so :focus-visible is exercised the way a keyboard user would.
    await page.keyboard.press('Tab');
    let hops = 0;
    const maxHops = 10;
    while (!(await swap.evaluate((el) => el === document.activeElement)) && hops < maxHops) {
      await page.keyboard.press('Tab');
      hops += 1;
    }
    await expect(swap).toBeFocused();

    const style = await swap.evaluate((el) => {
      const computed = getComputedStyle(el);
      return {
        outlineWidth: computed.outlineWidth,
        outlineStyle: computed.outlineStyle,
        outlineColor: computed.outlineColor,
        offset: computed.outlineOffset,
      };
    });
    expect(style.outlineWidth, 'focus outline width').not.toBe('0px');
    expect(style.outlineStyle, 'focus outline style').toBe('solid');
    expect(style.outlineColor).toBe('rgb(255, 255, 255)');
  });

  test('swap button label meets WCAG 4.5:1 contrast in default and hover states', async ({ page }) => {
    const swap = page.locator('#swap');

    /** Measure label color and effective background under `state` styles. */
    const measure = async (state) => {
      const foreground = await swap.evaluate((el, s) => {
        if (s === 'hover') {
          // Emulate the hover background without needing a real pointer.
          el.style.background = 'var(--swap-bg-hover)';
        } else {
          el.style.background = '';
        }
        return getComputedStyle(el).color;
      }, state);
      const background = await effectiveBackground(page, '#swap');
      await swap.evaluate((el) => { el.style.background = ''; });
      return { foreground: parseRgb(foreground), background };
    };

    for (const state of ['default', 'hover']) {
      const { foreground, background } = await measure(state);
      const ratio = contrastRatio(foreground, background);
      expect(
        ratio,
        `swap label contrast in ${state} state is ${ratio.toFixed(2)}:1 (need >= 4.5:1)`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });
});
