import test from "node:test";
import assert from "node:assert/strict";
import * as bookList from "./book-list.mjs";
import {
  createBook,
  filterBooks,
  sortBooks,
  setStatus,
  removeBook,
  loadBooks,
  saveBooks,
  STORAGE_KEY
} from "./book-list.mjs";

class MemoryStorage {
  constructor(initial = {}) {
    this._data = new Map(Object.entries(initial));
  }

  getItem(key) {
    return this._data.has(key) ? this._data.get(key) : null;
  }

  setItem(key, value) {
    this._data.set(key, String(value));
  }

  removeItem(key) {
    this._data.delete(key);
  }

  clear() {
    this._data.clear();
  }

  get length() {
    return this._data.size;
  }

  key(index) {
    return [...this._data.keys()][index] ?? null;
  }
}

function throwingStorage() {
  return {
    getItem() {
      throw new Error("blocked");
    },
    setItem() {
      throw new Error("blocked");
    }
  };
}

test("default storage getter failure is nonfatal and observable", () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    get() { throw new Error("storage access denied"); }
  });
  try {
    assert.deepEqual(loadBooks(), []);
    assert.deepEqual(saveBooks([]), { ok: false, error: "storage access denied" });
    assert.deepEqual(bookList.loadBooksResult(), { ok: false, books: [], error: "storage access denied" });
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "localStorage", descriptor);
    else delete globalThis.localStorage;
  }
});

test("loadBooksResult distinguishes unavailable storage from absent and malformed data", () => {
  assert.deepEqual(bookList.loadBooksResult(throwingStorage()), { ok: false, books: [], error: "blocked" });
  for (const raw of [null, "", "{bad json", "7", '{"books":"invalid"}']) {
    const storage = { getItem: () => raw };
    assert.deepEqual(bookList.loadBooksResult(storage), { ok: true, books: [] });
  }
  const books = [{ id: "1", title: "Dune", author: "Frank Herbert", status: "to-read" }];
  const storage = new MemoryStorage();
  saveBooks(books, storage);
  assert.deepEqual(bookList.loadBooksResult(storage), { ok: true, books });
});

test("createBook trims title and author and defaults status to to-read", () => {
  const result = createBook({ title: "  Dune  ", author: "  Frank Herbert " });
  assert.equal(result.ok, true);
  assert.equal(result.book.title, "Dune");
  assert.equal(result.book.author, "Frank Herbert");
  assert.equal(result.book.status, "to-read");
  assert.equal(typeof result.book.id, "string");
  assert.ok(result.book.id.length > 0);
});

test("createBook omits author when not provided", () => {
  const result = createBook({ title: "Novel" });
  assert.equal(result.ok, true);
  assert.equal(result.book.author, "");
});

test("createBook accepts an explicit finished status", () => {
  const result = createBook({ title: "Old", status: "finished" });
  assert.equal(result.ok, true);
  assert.equal(result.book.status, "finished");
});

test("createBook rejects blank and whitespace-only titles", () => {
  assert.equal(createBook({ title: "" }).ok, false);
  assert.equal(createBook({ title: "   " }).ok, false);
  assert.equal(createBook({ title: "\t\n" }).ok, false);
  assert.match(createBook({ title: "  " }).error, /[Tt]itle/);
});

test("createBook generates unique ids", () => {
  const a = createBook({ title: "A" }).book;
  const b = createBook({ title: "B" }).book;
  assert.notEqual(a.id, b.id);
});

test("filterBooks filters by all, to-read, and finished", () => {
  const books = [
    { id: "1", title: "A", author: "", status: "to-read" },
    { id: "2", title: "B", author: "", status: "finished" },
    { id: "3", title: "C", author: "", status: "to-read" }
  ];
  assert.deepEqual(
    filterBooks(books, "all").map((b) => b.id),
    ["1", "2", "3"]
  );
  assert.deepEqual(
    filterBooks(books, "to-read").map((b) => b.id),
    ["1", "3"]
  );
  assert.deepEqual(
    filterBooks(books, "finished").map((b) => b.id),
    ["2"]
  );
});

test("filterBooks returns an empty list for an empty source", () => {
  assert.deepEqual(filterBooks([], "to-read"), []);
});

test("filterBooks matches search case-insensitively on title and author", () => {
  const books = [
    { id: "1", title: "Dune", author: "Frank Herbert", status: "to-read" },
    { id: "2", title: "Project Hail Mary", author: "Andy Weir", status: "to-read" },
    { id: "3", title: "The Martian", author: "Andy Weir", status: "finished" }
  ];
  // Title match with mixed case.
  assert.deepEqual(filterBooks(books, "all", "dUnE").map((b) => b.id), ["1"]);
  // Author match with uppercase query.
  assert.deepEqual(filterBooks(books, "all", "HERBERT").map((b) => b.id), ["1"]);
  // Author matching multiple books.
  assert.deepEqual(filterBooks(books, "all", "andy weir").map((b) => b.id), ["2", "3"]);
});

test("filterBooks combines status filter and search", () => {
  const books = [
    { id: "1", title: "Dune", author: "Frank Herbert", status: "to-read" },
    { id: "2", title: "Dune Messiah", author: "Frank Herbert", status: "finished" },
    { id: "3", title: "Hyperion", author: "Dan Simmons", status: "finished" }
  ];
  assert.deepEqual(filterBooks(books, "finished", "dune").map((b) => b.id), ["2"]);
  assert.deepEqual(filterBooks(books, "to-read", "dune").map((b) => b.id), ["1"]);
  assert.deepEqual(filterBooks(books, "finished", "dune never"), []);
});

test("filterBooks ignores empty and whitespace-only search queries", () => {
  const books = [
    { id: "1", title: "A", author: "x", status: "to-read" },
    { id: "2", title: "B", author: "y", status: "finished" }
  ];
  assert.deepEqual(filterBooks(books, "all", "").map((b) => b.id), ["1", "2"]);
  assert.deepEqual(filterBooks(books, "all", "   ").map((b) => b.id), ["1", "2"]);
  assert.deepEqual(filterBooks(books, "all", "\t\n").map((b) => b.id), ["1", "2"]);
  // Two-argument callers keep their behavior.
  assert.deepEqual(filterBooks(books, "to-read").map((b) => b.id), ["1"]);
  assert.deepEqual(filterBooks(books, "finished").map((b) => b.id), ["2"]);
});

test("sortBooks orders titles A-Z for asc", () => {
  const books = [
    { id: "1", title: "Dune", author: "", status: "to-read" },
    { id: "2", title: "Foundation", author: "", status: "to-read" },
    { id: "3", title: "Hyperion", author: "", status: "to-read" }
  ];
  assert.deepEqual(sortBooks(books, "asc").map((b) => b.id), ["1", "2", "3"]);
});

test("sortBooks orders titles Z-A for desc", () => {
  const books = [
    { id: "1", title: "Dune", author: "", status: "to-read" },
    { id: "2", title: "Foundation", author: "", status: "to-read" },
    { id: "3", title: "Hyperion", author: "", status: "to-read" }
  ];
  assert.deepEqual(sortBooks(books, "desc").map((b) => b.id), ["3", "2", "1"]);
});

test("sortBooks defaults to asc when no direction is given", () => {
  const books = [
    { id: "1", title: "Hyperion", author: "", status: "to-read" },
    { id: "2", title: "Dune", author: "", status: "to-read" }
  ];
  assert.deepEqual(sortBooks(books).map((b) => b.id), ["2", "1"]);
});

test("sortBooks treats an unknown direction as asc", () => {
  const books = [
    { id: "1", title: "Hyperion", author: "", status: "to-read" },
    { id: "2", title: "Dune", author: "", status: "to-read" }
  ];
  assert.deepEqual(sortBooks(books, "sideways").map((b) => b.id), ["2", "1"]);
});

test("sortBooks does not mutate the source array", () => {
  const books = [
    { id: "1", title: "Hyperion", author: "", status: "to-read" },
    { id: "2", title: "Dune", author: "", status: "to-read" },
    { id: "3", title: "Foundation", author: "", status: "to-read" }
  ];
  const before = books.map((b) => b.id);
  const sorted = sortBooks(books, "asc");
  assert.deepEqual(books.map((b) => b.id), before);
  assert.notEqual(sorted, books);
  assert.deepEqual(sorted.map((b) => b.id), ["2", "3", "1"]);
});

test("sortBooks compares titles case-insensitively and is stable for case-equal titles", () => {
  const books = [
    { id: "1", title: "hyperion", author: "", status: "to-read" },
    { id: "2", title: "Dune", author: "", status: "to-read" },
    { id: "3", title: "HYPERION", author: "", status: "finished" },
    { id: "4", title: "dune", author: "", status: "to-read" }
  ];
  // With { sensitivity: "base" }, 'hyperion'/'HYPERION' and 'Dune'/'dune' each
  // compare equal, so the two case-equal pairs keep their input-relative order.
  assert.deepEqual(sortBooks(books, "asc").map((b) => b.id), ["2", "4", "1", "3"]);
  assert.deepEqual(sortBooks(books, "desc").map((b) => b.id), ["1", "3", "4", "2"]);
});

test("sortBooks composes with filterBooks for search and status", () => {
  const books = [
    { id: "1", title: "Delta", author: "Frank Herbert", status: "to-read" },
    { id: "2", title: "Charlie", author: "Frank Herbert", status: "finished" },
    { id: "3", title: "Hyperion", author: "Dan Simmons", status: "finished" },
    { id: "4", title: "Bravo", author: "Frank Herbert", status: "finished" }
  ];
  // Status filter keeps finished books: Charlie(2), Hyperion(3), Bravo(4).
  const visible = sortBooks(filterBooks(books, "finished"), "asc");
  assert.deepEqual(visible.map((b) => b.id), ["2", "4", "3"]);
  assert.deepEqual(
    sortBooks(filterBooks(books, "finished"), "desc").map((b) => b.id),
    ["3", "4", "2"]
  );
  // Compose with search: only books by 'herbert' survive the search.
  const searchVisible = sortBooks(filterBooks(books, "all", "herbert"), "asc");
  assert.deepEqual(searchVisible.map((b) => b.id), ["1", "2", "4"]);
});

test("setStatus changes status by id without touching other books", () => {
  const books = [
    { id: "1", title: "A", author: "", status: "to-read" },
    { id: "2", title: "B", author: "", status: "to-read" }
  ];
  const updated = setStatus(books, "2", "finished");
  assert.equal(updated[0].status, "to-read");
  assert.equal(updated[1].status, "finished");
  assert.equal(updated[1].title, "B");
});

test("setStatus ignores unknown ids and invalid statuses", () => {
  const books = [{ id: "1", title: "A", author: "", status: "to-read" }];
  assert.deepEqual(setStatus(books, "nope", "finished"), books);
  assert.deepEqual(setStatus(books, "1", "bogus"), books);
});

test("removeBook deletes by id and keeps the rest", () => {
  const books = [
    { id: "1", title: "A", author: "", status: "to-read" },
    { id: "2", title: "B", author: "", status: "to-read" },
    { id: "3", title: "C", author: "", status: "to-read" }
  ];
  const rest = removeBook(books, "2");
  assert.deepEqual(rest.map((b) => b.id), ["1", "3"]);
  assert.deepEqual(removeBook(books, "nope"), books);
});

test("saveBooks then loadBooks round-trips the list", () => {
  const storage = new MemoryStorage();
  const a = createBook({ title: "Dune", author: "Frank Herbert" }).book;
  const b = createBook({ title: "Hyperion" }).book;
  const result = saveBooks([a, b], storage);
  assert.equal(result.ok, true);
  const loaded = loadBooks(storage);
  assert.deepEqual(loaded, [a, b]);
});

test("loadBooks returns an empty list when no entry is stored", () => {
  assert.deepEqual(loadBooks(new MemoryStorage()), []);
});

test("loadBooks returns an empty list for malformed JSON", () => {
  const storage = new MemoryStorage({ [STORAGE_KEY]: "{not json" });
  assert.deepEqual(loadBooks(storage), []);
});

test("loadBooks discards records with invalid shapes or statuses", () => {
  const storage = new MemoryStorage({
    [STORAGE_KEY]: JSON.stringify({
      version: 1,
      books: [
        { id: "1", title: "Good", author: "", status: "to-read" },
        { id: "2", title: 42, author: "", status: "to-read" },
        { id: "3", title: "Bad status", author: "", status: "reading" },
        { id: "", title: "No id", author: "", status: "to-read" },
        "not an object",
        null
      ]
    })
  });
  const loaded = loadBooks(storage);
  assert.deepEqual(loaded, [{ id: "1", title: "Good", author: "", status: "to-read" }]);
});

test("loadBooks discards records with whitespace-only titles and keeps valid ones", () => {
  const storage = new MemoryStorage({
    [STORAGE_KEY]: JSON.stringify({
      version: 1,
      books: [
        { id: "1", title: "Good", author: "", status: "to-read" },
        { id: "2", title: " \t\n", author: "", status: "finished" }
      ]
    })
  });
  assert.deepEqual(loadBooks(storage), [{ id: "1", title: "Good", author: "", status: "to-read" }]);
});

test("loadBooks handles unexpected top-level shapes without crashing", () => {
  assert.deepEqual(
    loadBooks(new MemoryStorage({ [STORAGE_KEY]: JSON.stringify({ books: "nope" }) })),
    []
  );
  assert.deepEqual(
    loadBooks(new MemoryStorage({ [STORAGE_KEY]: JSON.stringify("just a string") })),
    []
  );
  assert.deepEqual(
    loadBooks(new MemoryStorage({ [STORAGE_KEY]: JSON.stringify(7) })),
    []
  );
});

test("loadBooks tolerates a plain array payload", () => {
  const storage = new MemoryStorage({
    [STORAGE_KEY]: JSON.stringify([
      { id: "1", title: "Array item", author: "", status: "finished" },
      { id: "2", title: "bad", status: 5 }
    ])
  });
  assert.deepEqual(loadBooks(storage), [
    { id: "1", title: "Array item", author: "", status: "finished" }
  ]);
});

test("loadBooks and saveBooks never throw when storage is blocked", () => {
  assert.deepEqual(loadBooks(throwingStorage()), []);
  const result = saveBooks([], throwingStorage());
  assert.equal(result.ok, false);
  assert.match(result.error, /blocked/);
});

test("status changes and deletions persist through save/load", () => {
  const storage = new MemoryStorage();
  let books = [];
  const added = createBook({ title: "Dune" }).book;
  books = [added];
  saveBooks(books, storage);

  books = setStatus(books, added.id, "finished");
  saveBooks(books, storage);
  assert.equal(loadBooks(storage)[0].status, "finished");

  books = removeBook(books, added.id);
  saveBooks(books, storage);
  assert.deepEqual(loadBooks(storage), []);
});
