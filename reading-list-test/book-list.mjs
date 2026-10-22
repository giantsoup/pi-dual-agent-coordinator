/**
 * Pure book-list logic: validation, construction, filtering, mutations,
 * and localStorage persistence for the reading list app.
 */

export const STORAGE_KEY = "reading-list.v1";

const STATUSES = new Set(["to-read", "finished"]);

let counter = 0;

function newId() {
  counter += 1;
  const time = Date.now().toString(36);
  return `${time}-${counter.toString(36)}`;
}

export function createBook({ title, author = "", status = "to-read" }) {
  const trimmedTitle = typeof title === "string" ? title.trim() : "";
  if (trimmedTitle === "") {
    return { ok: false, error: "Title is required." };
  }
  const trimmedAuthor = typeof author === "string" ? author.trim() : "";
  if (!STATUSES.has(status)) {
    return { ok: false, error: "Status must be 'to-read' or 'finished'." };
  }
  const book = { id: newId(), title: trimmedTitle, author: trimmedAuthor, status };
  return { ok: true, book };
}

export function filterBooks(books, filter, search = "") {
  let result;
  if (filter === "to-read") result = books.filter((b) => b.status === "to-read");
  else if (filter === "finished") result = books.filter((b) => b.status === "finished");
  else result = [...books];
  const query = typeof search === "string" ? search.trim().toLowerCase() : "";
  if (query === "") return result;
  return result.filter(
    (b) =>
      b.title.toLowerCase().includes(query) || b.author.toLowerCase().includes(query)
  );
}

const SORT_ORDERS = new Set(["asc", "desc"]);

/**
 * Return a new array of books sorted by title in the given direction.
 * `direction` must be "asc" (A–Z) or "desc" (Z–A). Title comparison is
 * case-insensitive (`sensitivity: "base"`); titles that differ only by
 * letter case compare equal, so the sort is stable with respect to their
 * input order. The source array is never mutated; a fresh array is always
 * returned.
 */
function titleCompare(a, b) {
  return a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
}

export function sortBooks(books, direction = "asc") {
  const dir = SORT_ORDERS.has(direction) ? direction : "asc";
  const factor = dir === "asc" ? 1 : -1;
  return [...books].sort((a, b) => factor * titleCompare(a, b));
}

export function setStatus(books, id, status) {
  if (!STATUSES.has(status)) return books;
  return books.map((b) => (b.id === id ? { ...b, status } : b));
}

export function removeBook(books, id) {
  return books.filter((b) => b.id !== id);
}

function isValidRecord(record) {
  return (
    record !== null &&
    typeof record === "object" &&
    !Array.isArray(record) &&
    typeof record.id === "string" &&
    record.id.length > 0 &&
    typeof record.title === "string" &&
    record.title.trim().length > 0 &&
    typeof record.author === "string" &&
    STATUSES.has(record.status)
  );
}

/**
 * Load books from localStorage. Any missing, malformed, or structurally
 * invalid data yields a usable list: invalid records are discarded, and a
 * bad top-level shape yields an empty list. Never throws.
 */
export function loadBooks(storage) {
  return loadBooksResult(storage).books;
}

export function loadBooksResult(storage) {
  let raw;
  try {
    if (storage === undefined) storage = globalThis.localStorage;
    raw = storage.getItem(STORAGE_KEY);
  } catch (error) {
    return { ok: false, books: [], error: error instanceof Error ? error.message : String(error) };
  }
  if (raw === null || raw === "") return { ok: true, books: [] };
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: true, books: [] };
  }
  if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) && Array.isArray(parsed.books)) {
    return { ok: true, books: parsed.books.filter(isValidRecord) };
  }
  if (Array.isArray(parsed)) {
    return { ok: true, books: parsed.filter(isValidRecord) };
  }
  return { ok: true, books: [] };
}

/**
 * Save books to localStorage. Write failures are caught and reported
 * instead of thrown, so a storage outage cannot crash the UI.
 */
export function saveBooks(books, storage) {
  try {
    if (storage === undefined) storage = globalThis.localStorage;
    storage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, books }));
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
