const treePane = document.getElementById("tree-pane");
const toggleTreeBtn = document.getElementById("toggle-tree-btn");

const treeContainer = document.getElementById("tree-container");
const editor = document.getElementById("editor");
const preview = document.getElementById("preview");
const stats = document.getElementById("stats");
const saveStatus = document.getElementById("save-status");

const tabEdit = document.getElementById("tab-edit");
const tabPreview = document.getElementById("tab-preview");

const addFolderBtn = document.getElementById("add-folder-btn");
const clipBtn = document.getElementById("clip-btn");
const deleteBtn = document.getElementById("delete-btn");

let folders = {};
let notes = {};
let activeNoteId = null;
let saveTimer = null;

// 2. Add the toggle click handler and restore previous state
toggleTreeBtn.addEventListener("click", () => {
  const isCollapsed = treePane.classList.toggle("collapsed");
  chrome.storage.local.set({ treeCollapsed: isCollapsed });
});

chrome.storage.local.get(["treeCollapsed"], (res) => {
  if (res.treeCollapsed) {
    treePane.classList.add("collapsed");
  }
});

const modalOverlay = document.getElementById("confirm-modal-overlay");
const modalTitle = document.getElementById("modal-title");
const modalMsg = document.getElementById("modal-message");
const modalInput = document.getElementById("modal-input");
const modalCancelBtn = document.getElementById("modal-cancel-btn");
const modalConfirmBtn = document.getElementById("modal-confirm-btn");

// Generic in-DOM Dialog Engine
function showCustomDialog({ title = "", message = "", defaultValue = null, isPrompt = false, isDanger = false, showCancel = true }) {
  return new Promise((resolve) => {
    modalTitle.textContent = title;
    modalTitle.style.display = title ? "block" : "none";

    modalMsg.textContent = message;
    modalMsg.style.display = message ? "block" : "none";

    if (isPrompt) {
      modalInput.style.display = "block";
      modalInput.value = defaultValue || "";
      setTimeout(() => {
        modalInput.focus();
        modalInput.select();
      }, 50);
    } else {
      modalInput.style.display = "none";
    }

    modalCancelBtn.style.display = showCancel ? "block" : "none";

    // Style confirm button based on action type
    modalConfirmBtn.className = isDanger ? "modal-btn danger" : "modal-btn confirm";
    modalConfirmBtn.textContent = isDanger ? "Delete" : "OK";

    modalOverlay.classList.add("open");

    const cleanup = () => {
      modalOverlay.classList.remove("open");
      modalCancelBtn.removeEventListener("click", onCancel);
      modalConfirmBtn.removeEventListener("click", onConfirm);
      window.removeEventListener("keydown", onKey);
    };

    const onCancel = () => {
      cleanup();
      resolve(null);
    };

    const onConfirm = () => {
      const val = isPrompt ? modalInput.value : true;
      cleanup();
      resolve(val);
    };

    const onKey = (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        onConfirm();
      } else if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      }
    };

    modalCancelBtn.addEventListener("click", onCancel);
    modalConfirmBtn.addEventListener("click", onConfirm);
    window.addEventListener("keydown", onKey);
  });
}

// Convenient wrappers
function showPromptDialog(title, defaultValue = "") {
  return showCustomDialog({ title, defaultValue, isPrompt: true });
}

function showConfirmDialog(message) {
  return showCustomDialog({ title: "Confirm", message, isDanger: true });
}

function showAlertDialog(message) {
  return showCustomDialog({ title: "Notice", message, showCancel: false });
}

// --- Minimal Markdown Parser ---
function renderMarkdown(md) {
  if (!md) return "<p style='color:#94a3b8;'>Nothing to preview</p>";
  let html = md
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/```([\s\S]*?)```/g, "<pre><code>$1</code></pre>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/^### (.*$)/gim, "<h3>$1</h3>")
    .replace(/^## (.*$)/gim, "<h2>$1</h2>")
    .replace(/^# (.*$)/gim, "<h1>$1</h1>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/^\> (.*$)/gim, "<blockquote>$1</blockquote>")
    .replace(/^\- (.*$)/gim, "<li>$1</li>")
    .replace(/\[ \]/g, '<input type="checkbox" disabled>')
    .replace(/\[x\]/g, '<input type="checkbox" checked disabled>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>')
    .replace(/\n\n/g, "</p><p>")
    .replace(/\n/g, "<br>");
  return `<p>${html}</p>`.replace(/<p><\/p>/g, "");
}

// --- Persistence ---
function persistData() {
  saveStatus.textContent = "Saving...";
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    chrome.storage.sync.set({ folders, notes, activeNoteId }, () => {
      saveStatus.textContent = "Saved";
    });
  }, 350);
}

function updateStats() {
  const text = editor.value.trim();
  const words = text ? text.split(/\s+/).length : 0;
  stats.textContent = `${words} words · ${text.length} chars`;
}

// --- Render Folder & Note Tree ---
function renderTree() {
  treeContainer.innerHTML = "";

  // Identify which folder holds the active note
  const activeFolderId = activeNoteId && notes[activeNoteId] ? notes[activeNoteId].folderId : null;

  Object.values(folders).forEach((folder) => {
    const folderGroup = document.createElement("div");
    folderGroup.className = "folder-group";

    // Auto-collapse if this folder does not contain the active note
    const isFolderActive = folder.id === activeFolderId;
    if (!isFolderActive) {
      folderGroup.classList.add("collapsed");
    }

    // Header with chevron indicator
    const header = document.createElement("div");
    header.className = "folder-header";
    header.innerHTML = `
      <div class="folder-name">
        <span class="chevron">▼</span>
        <span>📁 ${folder.name}</span>
      </div>
      <div class="folder-actions">
        <button class="icon-btn-sm add-note-in-folder" title="New Note in Folder">＋</button>
        <button class="icon-btn-sm del-folder" title="Delete Folder">✕</button>
      </div>
    `;

    // Click folder header to manually toggle collapse / expand
    header.addEventListener("click", () => {
      folderGroup.classList.toggle("collapsed");
    });

    // Add note button inside folder header
    header.querySelector(".add-note-in-folder").addEventListener("click", (e) => {
      e.stopPropagation();
      folderGroup.classList.remove("collapsed");
      createNote(folder.id, "Untitled");
    });

    // Delete folder button with custom modal confirmation
    header.querySelector(".del-folder").addEventListener("click", async (e) => {
      e.stopPropagation();
      if (Object.keys(folders).length <= 1) {
        await showAlertDialog("You must keep at least one folder.");
        return;
      }

      const count = Object.values(notes).filter((n) => n.folderId === folder.id).length;
      const warning = count > 0 
        ? `Delete "${folder.name}" and all ${count} note(s) inside it?` 
        : `Delete "${folder.name}"?`;

      const confirmed = await showConfirmDialog(warning);
      if (!confirmed) return;

      delete folders[folder.id];
      Object.keys(notes).forEach((nid) => {
        if (notes[nid].folderId === folder.id) delete notes[nid];
      });
      activeNoteId = Object.keys(notes)[0] || null;
      renderTree();
      loadActiveNote();
      persistData();
    });

    folderGroup.appendChild(header);

    // Notes List
    const noteList = document.createElement("div");
    noteList.className = "note-list";

    const folderNotes = Object.values(notes).filter((n) => n.folderId === folder.id);
    folderNotes.forEach((note) => {
      const item = document.createElement("div");
      item.className = `note-item ${note.id === activeNoteId ? "active" : ""}`;
      item.textContent = note.title || "Untitled";
      item.addEventListener("click", (e) => {
        e.stopPropagation();
        activeNoteId = note.id;
        renderTree();
        loadActiveNote();
        persistData();
      });
      noteList.appendChild(item);
    });

    folderGroup.appendChild(noteList);
    treeContainer.appendChild(folderGroup);
  });
}

function loadActiveNote() {
  if (activeNoteId && notes[activeNoteId]) {
    editor.value = notes[activeNoteId].content || "";
    editor.disabled = false;
  } else {
    editor.value = "";
    editor.disabled = true;
  }
  updateStats();
  if (tabPreview.classList.contains("active")) {
    preview.innerHTML = renderMarkdown(editor.value);
  }
}

function createNote(folderId, title = "Untitled") {
  const id = "note_" + Date.now();
  notes[id] = {
    id,
    folderId,
    title,
    content: "",
    updatedAt: Date.now()
  };
  activeNoteId = id;
  renderTree();
  loadActiveNote();
  persistData();
}

// Update title from first line
editor.addEventListener("input", () => {
  if (!activeNoteId || !notes[activeNoteId]) return;
  notes[activeNoteId].content = editor.value;
  notes[activeNoteId].updatedAt = Date.now();

  const firstLine = editor.value.trim().split("\n")[0]?.replace(/^[#\-\*\s]+/, "") || "Untitled";
  notes[activeNoteId].title = firstLine.slice(0, 20);

  // Update item label in tree without fully re-rendering
  const activeItem = treeContainer.querySelector(".note-item.active");
  if (activeItem) activeItem.textContent = notes[activeNoteId].title;

  updateStats();
  persistData();
});

// --- Toolbar Buttons ---
addFolderBtn.addEventListener("click", async () => {
  const name = await showPromptDialog("New Folder Name:", "New Folder");
  if (!name || !name.trim()) return;

  const fid = "f_" + Date.now();
  folders[fid] = { id: fid, name: name.trim() };
  renderTree();
  persistData();
});

deleteBtn.addEventListener("click", async () => {
  if (!activeNoteId || !notes[activeNoteId]) return;

  const currentTitle = notes[activeNoteId].title || "Untitled";
  const confirmed = await showConfirmDialog(`Delete "${currentTitle}"?`);
  if (!confirmed) return;

  delete notes[activeNoteId];
  activeNoteId = Object.keys(notes)[0] || null;
  renderTree();
  loadActiveNote();
  persistData();
});

// Clip feature
clipBtn.addEventListener("click", async () => {
  if (!activeNoteId) return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;

  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => window.getSelection().toString()
    });

    const clipText = result?.trim() ? `> ${result.trim()}\n\n` : "";
    const cite = `### [${tab.title}](${tab.url})\n${clipText}`;
    editor.value = editor.value ? `${editor.value}\n\n---\n${cite}` : cite;
    editor.dispatchEvent(new Event("input"));
  } catch (e) {
    console.error("Clipper error:", e);
  }
});

// Segmented write/preview controls
tabEdit.addEventListener("click", () => {
  tabEdit.classList.add("active");
  tabPreview.classList.remove("active");
  editor.style.display = "block";
  preview.style.display = "none";
});

tabPreview.addEventListener("click", () => {
  tabPreview.classList.add("active");
  tabEdit.classList.remove("active");
  preview.innerHTML = renderMarkdown(editor.value);
  editor.style.display = "none";
  preview.style.display = "block";
});

// --- Boot / Migration ---
chrome.storage.sync.get(["folders", "notes", "activeNoteId", "notebook"], (res) => {
  if (res.folders && Object.keys(res.folders).length > 0) {
    folders = res.folders;
    notes = res.notes || {};
    activeNoteId = res.activeNoteId && notes[res.activeNoteId] ? res.activeNoteId : Object.keys(notes)[0];
  } else {
    // Default / Seed data
    folders = {
      f_default: { id: "f_default", name: "General" }
    };
    notes = {
      n_seed: {
        id: "n_seed",
        folderId: "f_default",
        title: "Welcome Note",
        content: "# Folder Notes\n\nClick **📁+** to add folders or **＋** to create notes under any folder.",
        updatedAt: Date.now()
      }
    };
    activeNoteId = "n_seed";
  }

  renderTree();
  loadActiveNote();
});