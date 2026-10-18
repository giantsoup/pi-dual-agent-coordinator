/**
 * Calculator State Management Module
 * DOM-free state handling for testing and UI separation.
 */

export class CalculatorState {
  constructor() {
    this.clear();
  }

  clear() {
    this.currentInput = '0';
    this.previousValue = null;
    this.pendingOperator = null;
    this.newEntry = false;
    this.hasError = false;
    this.errorMessage = '';
  }

  /**
   * Sets the error state and clears pending operation.
   * @param {string} message - The error message to display.
   */
  setError(message) {
    this.hasError = true;
    this.errorMessage = message;
    this.currentInput = message;
    // Clear pending state so fresh input starts new calculation
    this.previousValue = null;
    this.pendingOperator = null;
    this.newEntry = true;
  }

  resetForNewInput() {
    this.currentInput = '0';
    this.newEntry = true;
    this.hasError = false;
    this.errorMessage = '';
  }

  appendDigit(digit) {
    // After an error, starting a digit begins fresh calculation
    if (this.hasError) {
      this.clear();
      this.currentInput = digit;
      return;
    }
    
    if (this.newEntry) {
      this.currentInput = digit;
      this.newEntry = false;
    } else if (this.currentInput === '0') {
      this.currentInput = digit;
    } else {
      this.currentInput += digit;
    }
  }

  appendDecimal() {
    // After an error, starting a decimal begins fresh calculation
    if (this.hasError) {
      this.clear();
      this.currentInput = '0.';
      return;
    }
    
    if (this.newEntry) {
      this.currentInput = '0.';
      this.newEntry = false;
    } else if (!this.currentInput.includes('.')) {
      this.currentInput += '.';
    }
  }

  appendSign() {
    if (this.hasError) return;
    
    if (this.currentInput === '0') return;
    this.currentInput = (parseFloat(this.currentInput) * -1).toString();
  }

  backspace() {
    if (this.hasError) {
      this.clear();
      return;
    }
    
    if (this.newEntry) {
      this.currentInput = '0';
      return;
    }
    
    if (this.currentInput.length === 1) {
      this.currentInput = '0';
    } else {
      this.currentInput = this.currentInput.slice(0, -1);
    }
  }

  /**
   * Sets an operator, computing any pending operation first.
   * @param {string} operator - The operator to set ('+', '-', '*', '/').
   * @returns {boolean} true if successful, false if an error occurred.
   */
  setOperator(operator) {
    // Can't set operator during an error state
    if (this.hasError) return false;
    
    // If we have a pending operation, calculate it first
    if (this.pendingOperator && !this.newEntry) {
      try {
        const result = this._computePending();
        if (result === null) return false;
        this.previousValue = result.toString();
        this.currentInput = '0';
      } catch (error) {
        this.setError(error.message);
        return false;
      }
    } else if (!this.previousValue) {
      this.previousValue = this.currentInput;
      this.newEntry = true;
    }
    
    this.pendingOperator = operator;
    return true;
  }

  /**
   * Computes the pending operation using previousValue, pendingOperator, and currentInput.
   * @returns {number|null} The result or null if computation failed.
   */
  _computePending() {
    if (!this.pendingOperator || !this.previousValue) return parseFloat(this.currentInput);
    
    const left = parseFloat(this.previousValue);
    const right = parseFloat(this.currentInput);
    
    switch (this.pendingOperator) {
      case '+':
        return left + right;
      case '-':
        return left - right;
      case '*':
        return left * right;
      case '/':
        if (right === 0) {
          throw new Error('Division by zero is not allowed');
        }
        return left / right;
      default:
        throw new Error(`Invalid operator: '${this.pendingOperator}'`);
    }
  }

  evaluate() {
    if (!this.pendingOperator || this.newEntry) return null;
    
    try {
      const result = this._computePending();
      if (result === null) return null;
      
      // Clear state after successful evaluation
      this.previousValue = null;
      this.pendingOperator = null;
      this.newEntry = true;
      
      return result.toString();
    } catch (error) {
      this.setError(error.message);
      return null;
    }
  }

  /**
   * Checks if the current input represents a valid number.
   * @returns {boolean}
   */
  isValidInput() {
    if (this.currentInput === '' || this.currentInput === '-') return false;
    const num = Number(this.currentInput);
    return Number.isFinite(num);
  }

  getDisplay() {
    // Truncate long numbers for display
    if (this.currentInput.length > 12) {
      const num = parseFloat(this.currentInput);
      return num.toExponential(6);
    }
    return this.currentInput;
  }

  /**
   * Gets the current error message (empty if no error).
   * @returns {string}
   */
  getErrorMessage() {
    return this.hasError ? this.errorMessage : '';
  }

  /**
   * Checks if a fresh digit entry should start a new calculation.
   * @param {string} digit - The digit being entered.
   * @returns {boolean}
   */
  shouldClearOnDigitEntry(digit) {
    return this.hasError || this.newEntry;
  }
}
