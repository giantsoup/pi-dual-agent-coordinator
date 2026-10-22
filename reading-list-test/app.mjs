import {
  createBook,
  filterBooks,
  sortBooks,
  setStatus,
  removeBook,
  loadBooksResult,
  saveBooks
} from "./book-list.mjs";

const form = document.getElementById("add-form");
const titleInput = document.getElementById("title-input");
const authorInput = document.getElementById("author-input");
const statusMessage = document.getElementById("status-message");
const bookListEl = document.getElementById("book-list");
const emptyMessage = document.getElementById("empty-message");
const storageMessage = document.getElementById("storage-message");
const template = document.getElementById("book-item-template");
const filterInputs = form.ownerDocument.querySelectorAll('input[name="filter"]');
const searchInput = document.getElementById("search-input");
const clearSearchButton = document.getElementById("clear-search-button");
const sortSelect = document.getElementById("sort-select");

const initialLoad = loadBooksResult();
let books = initialLoad.books;
if (!initialLoad.ok) {
  storageMessage.textContent = "Warning: could not read your saved list. Storage is unavailable.";
}
let activeFilter = "all";
let activeSearch = "";
let sortDirection = "asc";

function setMessage(kind, text) {
  statusMessage.textContent = text;
  statusMessage.classList.toggle("error", kind === "error");
  statusMessage.classList.toggle("success", kind === "success");
}

function persist() {
  const result = saveBooks(books);
  storageMessage.textContent = result.ok
    ? ""
    : `Warning: could not save your list. Changes will be lost on reload.`;
}

function createItemElement(book) {
  const node = template.content.firstElementChild.cloneNode(true);
  const titleEl = node.querySelector(".book-title");
  const authorEl = node.querySelector(".book-author");
  const toggle = node.querySelector(".status-toggle");
  const statusText = node.querySelector(".status-text");
  const deleteButton = node.querySelector(".delete-button");

  // Render user text as text only; never as HTML.
  titleEl.textContent = book.title;
  authorEl.textContent = book.author;
  titleEl.id = `book-title-${book.id}`;
  titleEl.title = book.title;

  const finished = book.status === "finished";
  toggle.checked = finished;
  toggle.id = `status-toggle-${book.id}`;
  toggle.setAttribute("aria-label", `${finished ? "Mark to read" : "Mark finished"}: ${book.title}`);
  statusText.textContent = finished ? "Mark to read" : "Mark finished";

  toggle.addEventListener("change", () => {
    const next = toggle.checked ? "finished" : "to-read";
    books = setStatus(books, book.id, next);
    persist();
    render();
  });

  deleteButton.setAttribute("aria-label", `Delete ${book.title}`);
  deleteButton.addEventListener("click", () => {
    books = removeBook(books, book.id);
    persist();
    setMessage("success", `Deleted “${book.title}”.`);
    render();
  });

  return node;
}

function render() {
  clearSearchButton.disabled = activeSearch.trim() === "";
  const visible = sortBooks(filterBooks(books, activeFilter, activeSearch), sortDirection);
  bookListEl.textContent = "";
  for (const book of visible) {
    bookListEl.appendChild(createItemElement(book));
  }

  if (books.length === 0) {
    emptyMessage.textContent = "No books yet. Add your first book above.";
  } else if (visible.length === 0) {
    if (activeSearch.trim() !== "") {
      const statusLabel =
        activeFilter === "all" ? "" : ` ${activeFilter === "to-read" ? "to-read" : "finished"}`;
      emptyMessage.textContent = `No${statusLabel} books match “${activeSearch.trim()}”. Try a different search or status filter.`;
    } else {
      emptyMessage.textContent = `No ${activeFilter === "to-read" ? "to-read" : "finished"} books right now.`;
    }
  } else {
    emptyMessage.textContent = "";
  }
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const result = createBook({
    title: titleInput.value,
    author: authorInput.value,
    status: "to-read"
  });
  if (!result.ok) {
    setMessage("error", result.error);
    titleInput.focus();
    return;
  }
  books = [...books, result.book];
  persist();
  form.reset();
  titleInput.focus();
  setMessage("success", `Added “${result.book.title}”.`);
  render();
});

for (const input of filterInputs) {
  input.addEventListener("change", () => {
    if (input.checked) {
      activeFilter = input.value;
      render();
    }
  });
}

searchInput.addEventListener("input", () => {
  activeSearch = searchInput.value;
  render();
});

searchInput.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    searchInput.value = "";
    activeSearch = "";
    render();
    searchInput.focus();
  }
});

clearSearchButton.addEventListener("click", () => {
  searchInput.value = "";
  activeSearch = "";
  render();
  searchInput.focus();
});

sortSelect.addEventListener("change", () => {
  sortDirection = sortSelect.value === "desc" ? "desc" : "asc";
  render();
});

render();
