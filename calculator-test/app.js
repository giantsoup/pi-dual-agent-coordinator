/**
 * Calculator UI Controller
 * Handles DOM manipulation, event wiring, and state management.
 * Arithmetic is delegated to calculator.mjs module.
 */

import { calculate, evaluateChain, parseNumber } from './calculator.mjs';
import { CalculatorState } from './calculator-state.mjs';

/**
 * Calculator UI controller
 */
class CalculatorUI {
  constructor() {
    this.state = new CalculatorState();
    this.displayElement = null;
    this.init();
  }

  init() {
    // Use existing main element or create one
    const mainElement = document.querySelector('main.calculator-main') || document.body;
    
    const container = document.createElement('div');
    container.className = 'calculator-container';
    container.setAttribute('role', 'application');
    container.setAttribute('aria-label', 'Calculator');

    // Display
    this.displayElement = document.createElement('div');
    this.displayElement.className = 'display';
    this.displayElement.setAttribute('role', 'status');
    this.displayElement.setAttribute('aria-live', 'polite');
    this.updateDisplay();

    // Button configuration
    const buttons = [
      { label: 'AC', action: 'clear', class: 'btn-clear' },
      { label: 'C', action: 'cancel', class: 'btn-cancel' },
      { label: '⌫', action: 'backspace', class: 'btn-backspace' },
      { label: '/', action: 'operator', value: '/', class: 'btn-operator' },
      
      { label: '7', action: 'digit', value: '7', class: 'btn-digit' },
      { label: '8', action: 'digit', value: '8', class: 'btn-digit' },
      { label: '9', action: 'digit', value: '9', class: 'btn-digit' },
      { label: '*', action: 'operator', value: '*', class: 'btn-operator' },
      
      { label: '4', action: 'digit', value: '4', class: 'btn-digit' },
      { label: '5', action: 'digit', value: '5', class: 'btn-digit' },
      { label: '6', action: 'digit', value: '6', class: 'btn-digit' },
      { label: '-', action: 'operator', value: '-', class: 'btn-operator' },
      
      { label: '1', action: 'digit', value: '1', class: 'btn-digit' },
      { label: '2', action: 'digit', value: '2', class: 'btn-digit' },
      { label: '3', action: 'digit', value: '3', class: 'btn-digit' },
      { label: '+', action: 'operator', value: '+', class: 'btn-operator' },
      
      { label: '±', action: 'sign', class: 'btn-sign' },
      { label: '0', action: 'digit', value: '0', class: 'btn-digit' },
      { label: '.', action: 'decimal', class: 'btn-decimal' },
      { label: '=', action: 'equals', class: 'btn-equals' },
    ];

    const keypad = document.createElement('div');
    keypad.className = 'keypad';

    buttons.forEach(btn => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = btn.label;
      button.className = `btn ${btn.class}`;
      button.setAttribute('aria-label', this.getButtonAriaLabel(btn));
      
      // Touch target: minimum 44px height
      button.style.minHeight = '44px';
      button.dataset.action = btn.action;
      if (btn.value !== undefined) {
        button.dataset.value = btn.value;
      }

      keypad.appendChild(button);
    });

    container.appendChild(this.displayElement);
    container.appendChild(keypad);
    mainElement.appendChild(container);

    // Event listeners
    this.setupEventListeners();
  }

  getButtonAriaLabel(btn) {
    const labels = {
      'AC': 'All clear',
      'C': 'Clear current entry',
      '⌫': 'Backspace, delete last digit',
      '/': 'Divide',
      '*': 'Multiply',
      '-': 'Subtract',
      '+': 'Add',
      '±': 'Toggle sign',
      '.': 'Decimal point',
      '=': 'Equals, calculate result'
    };
    return labels[btn.label] || btn.label;
  }

  setupEventListeners() {
    // Button clicks
    document.addEventListener('click', (e) => {
      const button = e.target.closest('.btn');
      if (!button) return;
      
      this.handleAction(button.dataset.action, button.dataset.value);
    });

    // Keyboard support
    document.addEventListener('keydown', (e) => this.handleKey(e));
  }

  handleAction(action, value) {
    switch (action) {
      case 'digit':
        this.state.appendDigit(value);
        break;
      case 'decimal':
        this.state.appendDecimal();
        break;
      case 'sign':
        this.state.appendSign();
        break;
      case 'backspace':
        this.state.backspace();
        break;
      case 'clear':
        this.state.clear();
        break;
      case 'cancel':
        this.state.resetForNewInput();
        break;
      case 'operator':
        const operatorResult = this.state.setOperator(value);
        if (!operatorResult) {
          // Error occurred during operation setting
          this.updateDisplay();
        }
        break;
      case 'equals':
        const result = this.state.evaluate();
        if (result !== null) {
          this.state.currentInput = result;
        }
        break;
    }
    
    // Always update display, including when there's an error
    this.updateDisplay();
  }

  handleKey(e) {
    const key = e.key;
    
    // Prevent default for calculator keys
    if (this.isCalculatorKey(key)) {
      e.preventDefault();
    }

    // Digits
    if (/^\d$/.test(key)) {
      this.handleAction('digit', key);
      return;
    }

    // Decimal
    if (key === '.') {
      this.handleAction('decimal');
      return;
    }

    // Operators
    if (['+', '-', '*', '/'].includes(key)) {
      this.handleAction('operator', key);
      return;
    }

    // Enter/Equals
    if (key === 'Enter' || key === '=') {
      this.handleAction('equals');
      return;
    }

    // Escape/Backspace
    if (key === 'Escape' || key === 'c' || key === 'C') {
      this.state.clear();
      this.updateDisplay();
      return;
    }

    if (key === 'Backspace') {
      this.handleAction('backspace');
      return;
    }
  }

  isCalculatorKey(key) {
    return /^[0-9.+\-*/=]$/.test(key) || 
           key === 'Enter' || 
           key === 'Escape' || 
           key === 'Backspace';
  }

  updateDisplay() {
    this.displayElement.textContent = this.state.getDisplay();
    
    // Announce error for screen readers
    if (this.state.hasError) {
      this.displayElement.setAttribute('role', 'alert');
      this.displayElement.setAttribute('aria-label', this.state.getErrorMessage());
    } else {
      this.displayElement.setAttribute('role', 'status');
    }
  }
}

// Initialize on DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => new CalculatorUI());
} else {
  new CalculatorUI();
}
