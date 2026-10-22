import test from "node:test";
import assert from "node:assert/strict";
import { sortBooks } from "./book-list.mjs";
test("ascending titles", () => {
  assert.deepEqual(sortBooks([{id:"b", title:"Bravo"}, {id:"a", title:"Alpha"}], "asc").map(book => book.id), ["a", "b"]);
});
