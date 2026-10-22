# Reading List

A small, dependency-free reading list app built with plain HTML, CSS, and JavaScript. No build step, no external assets, no network requests.

## Features

- Add books with a required title and an optional author (both are trimmed; whitespace-only titles are rejected with a clear message).
- Each book starts with a stable id, a title, an author, and a status of `to-read`.
- Toggle a book's status between `to-read` and `finished`.
- Filter the list by **All**, **To read**, or **Finished**.
- Search live by title or author (case-insensitive), combined with the status filter. A **Clear search** button resets the query and re-shows results for the active status filter; it is disabled when the query is empty. Pressing Escape while the search field is focused clears the query the same way, keeps focus in the field, and leaves the active status filter unchanged.
- Sort the visible books by title with a **Sort by title** select (**A → Z** or **Z → A**). Sorting only reorders the displayed list and composes with the active status filter and search; it never reorders the saved list or mutates the underlying records. The default is A → Z.
- Delete books.
- Distinct empty messages when the list is empty, when the active status filter has no matches, or when a nonblank search has no matches (suggesting a different search or status filter).
- The list persists to `localStorage` and is restored after reload. Missing, malformed, or structurally invalid saved data falls back safely to an empty list without crashing.
- Unavailable storage, including a throwing `localStorage` getter, shows a warning while the app remains usable in memory. `loadBooksResult()` reports read failures separately from missing or malformed saved data.
- Titles and authors are rendered as text only, so markup-like input (e.g. `<img src=x onerror=alert(1)>`) displays literally.
- Fully keyboard-operable native controls with visible focus styling and accessible labels.

## Run the app

The app is static, so serve the directory with any local HTTP server. From this folder:

```sh
python3 -m http.server 4173 --bind 127.0.0.1
```

Then open <http://127.0.0.1:4173/> in a browser. (Any local port works; 4173 is just a convenient default.)

## Run the tests

The list logic in `book-list.mjs` is covered by tests written with Node's built-in test runner (no dependencies). From this folder:

```sh
node --test book-list.test.mjs
```

All tests should pass.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Page structure: form, filter, search, sort, list, live status message. |
| `styles.css` | Responsive layout, dark-mode support, visible focus styling. |
| `app.mjs` | DOM wiring: renders books with text nodes, handles form/filter/search/sort/status/delete. |

| `book-list.mjs` | Pure list logic, title sorting, and `localStorage` persistence. |
| `book-list.test.mjs` | `node:test` tests for the list logic. |
