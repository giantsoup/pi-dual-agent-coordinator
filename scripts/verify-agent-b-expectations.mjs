// Audit every assertion in the two known-failing cases, including unreachable assertions.
import assert from 'node:assert/strict';
import { sortBooks, filterBooks } from '../test/fixtures/agent-b-reliability/book-list.mjs';
const ids = books => books.map(book => book.id);
const stable = [
  { id: '1', title: 'hyperion', status: 'to-read' }, { id: '2', title: 'Dune', status: 'to-read' },
  { id: '3', title: 'HYPERION', status: 'finished' }, { id: '4', title: 'dune', status: 'to-read' }
];
const composed = [
  { id: '1', title: 'Delta', author: 'Frank Herbert', status: 'to-read' },
  { id: '2', title: 'Charlie', author: 'Frank Herbert', status: 'finished' },
  { id: '3', title: 'Hyperion', author: 'Dan Simmons', status: 'finished' },
  { id: '4', title: 'Bravo', author: 'Frank Herbert', status: 'finished' }
];
export const assertions = [
  { test: 'sortBooks compares titles case-insensitively and is stable for case-equal titles', direction: 'asc', expected: ['2','4','1','3'], actual: ids(sortBooks(stable, 'asc')), correct: true, reached: true },
  { test: 'sortBooks compares titles case-insensitively and is stable for case-equal titles', direction: 'desc', expected: ['1','3','4','2'], actual: ids(sortBooks(stable, 'desc')), correct: false, reached: true },
  { test: 'sortBooks composes with filterBooks for search and status', direction: 'asc', expected: ['2','4','3'], actual: ids(sortBooks(filterBooks(composed, 'finished'), 'asc')), correct: false, reached: true },
  { test: 'sortBooks composes with filterBooks for search and status', direction: 'desc', expected: ['3','4','2'], actual: ids(sortBooks(filterBooks(composed, 'finished'), 'desc')), correct: false, reached: false },
  { test: 'sortBooks composes with filterBooks for search and status', direction: 'asc-search', expected: ['1','2','4'], actual: ids(sortBooks(filterBooks(composed, 'all', 'herbert'), 'asc')), correct: false, reached: false }
];
assert.deepEqual(assertions.map(item => item.actual), [['2','4','1','3'], ['1','3','2','4'], ['4','2','3'], ['3','2','4'], ['4','2','1']]);
for (const item of assertions) assert.equal(JSON.stringify(item.actual) === JSON.stringify(item.expected), item.correct);
if (process.argv[1]?.endsWith('verify-agent-b-expectations.mjs')) console.log(JSON.stringify({ outcome: 'passed', assertions }, null, 2));
