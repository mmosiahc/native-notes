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

// Generic in-DOM Dialog Engine
const modalOverlay = document.getElementById("confirm-modal-overlay");
const modalTitle = document.getElementById("modal-title");
const modalMsg = document.getElementById("modal-message");
const modalInput = document.getElementById("modal-input");
const modalCancelBtn = document.getElementById("modal-cancel-btn");
const modalExtraBtn = document.getElementById("modal-extra-btn");
const modalConfirmBtn = document.getElementById("modal-confirm-btn");

function showCustomDialog({
  title = "",
  message = "",
  defaultValue = null,
  isPrompt = false,
  isDanger = false,
  showCancel = true,
  confirmLabel = null,
  cancelLabel = "Cancel",
  extraBtnLabel = null
}) {
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

    // Cancel Button
    modalCancelBtn.style.display = showCancel ? "block" : "none";
    modalCancelBtn.textContent = cancelLabel;

    // Optional Extra Action Button
    if (extraBtnLabel) {
      modalExtraBtn.style.display = "block";
      modalExtraBtn.textContent = extraBtnLabel;
    } else {
      modalExtraBtn.style.display = "none";
    }

    // Confirm Button
    modalConfirmBtn.className = isDanger ? "modal-btn danger" : "modal-btn confirm";
    modalConfirmBtn.textContent = confirmLabel || (isDanger ? "Delete" : "OK");

    modalOverlay.classList.add("open");

    const cleanup = () => {
      modalOverlay.classList.remove("open");
      modalCancelBtn.removeEventListener("click", onCancel);
      modalExtraBtn.removeEventListener("click", onExtra);
      modalConfirmBtn.removeEventListener("click", onConfirm);
      window.removeEventListener("keydown", onKey);
    };

    const onCancel = () => {
      cleanup();
      resolve(null);
    };

    const onExtra = () => {
      cleanup();
      resolve("EXTRA");
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
    modalExtraBtn.addEventListener("click", onExtra);
    modalConfirmBtn.addEventListener("click", onConfirm);
    window.addEventListener("keydown", onKey);
  });
}

// Convenient wrappers
function showPromptDialog({title = "Prompt", message = "", defaultValue = ""}) {
  return showCustomDialog({ title, message, defaultValue, isPrompt: true });
}

function showConfirmDialog(message, title = "Confirm") {
  return showCustomDialog({ title, message, isDanger: true });
}

function showAlertDialog(message, title = "Notice") {
  return showCustomDialog({ title, message, showCancel: false });
}

// --- Minimal Markdown Parser ---
function renderMarkdown(md) {
  if (!md) return "<p style='color:#94a3b8;'>Nothing to preview</p>";

  // Configure GFM features
  marked.setOptions({
    gfm: true,
    breaks: true // Renders single line breaks as <br>
  });

  return marked.parse(md);
}

// --- Persistence ---
function persistData() {
  saveStatus.textContent = "Saving...";
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    chrome.storage.local.set({ folders, notes, activeNoteId }, () => {
      saveStatus.textContent = "Saved";
      // Auto-commit to Git in the background without any button presses
      syncActiveNoteToGit();
    });
  }, 400);
}

function updateStats() {
  const text = editor.value.trim();
  const words = text ? text.split(/\s+/).length : 0;
  stats.textContent = `${words} words · ${text.length} chars`;
}

// --- Git Integration State & Helpers ---
const gitIndicator = document.getElementById("git-indicator");
const gitStatusText = document.getElementById("git-status-text");
const gitConfigBtn = document.getElementById("git-config-btn");

let gitConfig = null; // { token, owner, repo, branch }
let isGitSyncing = false;

// Load Git credentials on startup
chrome.storage.local.get(["gitConfig"], (res) => {
  if (res.gitConfig && res.gitConfig.token) {
    gitConfig = res.gitConfig;
    gitIndicator.style.display = "inline-flex";
    gitStatusText.textContent = `${gitConfig.repo}:${gitConfig.branch || "main"}`;
  }
});

// Check if a valid, functional Git configuration exists
function isGitConnected() {
  return Boolean(gitConfig && gitConfig.token && gitConfig.owner && gitConfig.repo);
}

// Full Onboarding Flow
async function startGitOnboarding() {
  const repoPath = await showPromptDialog({
    title: "Step 1: GitHub Repository",
    message: "Enter an existing repository (must exist on GitHub):\nFormat: username/repo-name",
    defaultValue: gitConfig ? `${gitConfig.owner}/${gitConfig.repo}` : ""
  });
  if (!repoPath || !repoPath.includes("/")) return;

  const [owner, repo] = repoPath.split("/").map((s) => s.trim());

  const tokenNotice =
    `Enter a Fine-Grained PAT with access to "${repo}".\n\n` +
    `• Target: "${repo}"\n` +
    `• Permissions: Contents (Read & Write)\n\n` +
    `Note: Edits continuously create Git commits.`;

  const token = await showPromptDialog({
    title: "Step 2: Access Token",
    message: tokenNotice,
    defaultValue: gitConfig?.token || ""
  });
  if (!token) return;

  const candidateConfig = { token: token.trim(), owner, repo, branch: "main" };

  saveStatus.textContent = "Verifying Git...";
  try {
    const originalConfig = gitConfig;
    gitConfig = candidateConfig;
    await verifyRepoAccess();

    await chrome.storage.local.set({ gitConfig });
    gitIndicator.style.display = "inline-flex";
    gitStatusText.textContent = `${repo}:main`;

    await showAlertDialog(`Connected to ${repo}! Notes will now sync automatically.`, "Connected");
    syncActiveNoteToGit();
  } catch (err) {
    gitConfig = originalConfig;
    console.error(err);
    await showAlertDialog(`Git Setup Failed:\n\n${err.message}`, "Error");
    saveStatus.textContent = "Git setup error";
  }
}

// Git Button Click Handler
gitConfigBtn.addEventListener("click", async () => {
  // If already connected, show the status modal
  if (isGitConnected()) {
    const statusDetails =
      `Status: Connected\n` +
      `Repository: ${gitConfig.owner}/${gitConfig.repo}\n` +
      `Target Branch: ${gitConfig.branch || "main"}\n` +
      `Sync: Continuous Background Commits`;

    const choice = await showCustomDialog({
      title: "Git Integration Status",
      message: statusDetails,
      showCancel: true,
      cancelLabel: "Close",
      extraBtnLabel: "Disconnect",
      confirmLabel: "Reconfigure"
    });

    if (choice === true) {
      // User clicked "Reconfigure"
      startGitOnboarding();
    } else if (choice === "EXTRA") {
      // User clicked "Disconnect"
      const confirmed = await showConfirmDialog(
        `Disconnect from ${gitConfig.owner}/${gitConfig.repo}? Your local notes will remain untouched, but background sync will stop.`
      );
      if (confirmed) {
        gitConfig = null;
        await chrome.storage.local.remove("gitConfig");
        gitIndicator.style.display = "none";
        gitStatusText.textContent = "";
        saveStatus.textContent = "Git disconnected";
        setTimeout(() => (saveStatus.textContent = "Saved"), 2000);
      }
    }
    return;
  }

  // Not connected yet: Launch onboarding
  startGitOnboarding();
});

// Silent Background Committer
// Conflict-Free, One-Way Push Engine (Native Notes -> GitHub)
// Helper: Verify repository exists, or auto-create as strictly PRIVATE
async function verifyRepoAccess() {
  const repoCheckUrl = `https://api.github.com/repos/${gitConfig.owner}/${gitConfig.repo}`;
  const headers = {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${gitConfig.token}`,
    "X-GitHub-Api-Version": "2022-11-28"
  };

  const res = await fetch(repoCheckUrl, { headers });
  if (res.ok) return true;

  if (res.status === 404) {
    throw new Error(
      `Cannot find "${gitConfig.owner}/${gitConfig.repo}".\n` +
      "Make sure the repo exists on GitHub and your token is granted access to it."
    );
  }

  if (res.status === 401 || res.status === 403) {
    throw new Error("Access denied. Please check your token permissions (Contents: Read & Write).");
  }
  return res.ok;
}

// Conflict-Free, Auto-Provisioning Push Engine
async function syncActiveNoteToGit() {
  if (!gitConfig || !activeNoteId || !notes[activeNoteId] || isGitSyncing) return;

  const note = notes[activeNoteId];
  const folderName = folders[note.folderId]?.name || "General";
  
  const cleanFolder = folderName.replace(/[/\\?%*:|"<>]/g, "-").trim();
  const cleanTitle = (note.title || "Untitled").replace(/[/\\?%*:|"<>]/g, "-").trim();
  const filePath = `${cleanFolder}/${cleanTitle}.md`;

  isGitSyncing = true;
  saveStatus.textContent = "Committing...";

  try {
    const apiBase = `https://api.github.com/repos/${gitConfig.owner}/${gitConfig.repo}/contents/${encodeURIComponent(filePath)}`;
    const headers = {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${gitConfig.token}`,
      "X-GitHub-Api-Version": "2022-11-28"
    };

    // 1. Fetch remote SHA (if file exists)
    let fileSha = null;
    const checkRes = await fetch(`${apiBase}?ref=${gitConfig.branch || "main"}&_=${Date.now()}`, {
      method: "GET",
      headers
    });

    if (checkRes.ok) {
      const data = await checkRes.json();
      fileSha = data.sha;
    }

    // 2. Encode UTF-8 content
    const contentPayload = note.content || `# ${note.title}\n`;
    const base64Content = btoa(unescape(encodeURIComponent(contentPayload)));

    // 3. Commit update
    const putRes = await fetch(apiBase, {
      method: "PUT",
      headers,
      body: JSON.stringify({
        message: `Update ${filePath} [Native Notes]`,
        content: base64Content,
        sha: fileSha || undefined,
        branch: gitConfig.branch || "main"
      })
    });

    if (!putRes.ok) {
      const err = await putRes.json();
      throw new Error(err.message || putRes.statusText);
    }

    saveStatus.textContent = "Git Backed Up";
    setTimeout(() => (saveStatus.textContent = "Saved"), 2000);
  } catch (err) {
    if (err.message && err.message.includes("401")) {
      saveStatus.textContent = "Git auth failed";
    } else {
      console.warn("Git sync skipped:", err.message);
      saveStatus.textContent = "Saved locally";
    }
  } finally {
    isGitSyncing = false;
  }
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

    // Header with chevron indicator, truncated label, and full-name tooltip
    const header = document.createElement("div");
    header.className = "folder-header";
    header.innerHTML = `
      <div class="folder-name">
        <span class="chevron">▼</span>
        <span class="folder-label" title="${folder.name}">📁 ${folder.name}</span>
      </div>
      <div class="folder-actions">
        <button class="icon-btn-sm add-note-in-folder" title="New Note in Folder">＋</button>
        <button class="icon-btn-sm del-folder" title="Delete Folder">✕</button>
      </div>
    `;

    // Click folder header to toggle collapse / expand
    header.addEventListener("click", () => {
      folderGroup.classList.toggle("collapsed");
    });

    // Double-click folder name to rename
    const folderLabel = header.querySelector(".folder-label");
    folderLabel.addEventListener("dblclick", async (e) => {
      e.stopPropagation(); // Prevents collapsing/expanding the folder on double click

      const updatedName = await showPromptDialog({
        title: "Rename Folder",
        message: "Enter new folder name:",
        defaultValue: folder.name
      });

      if (!updatedName || !updatedName.trim() || updatedName.trim() === folder.name) {
        return;
      }

      folders[folder.id].name = updatedName.trim();
      renderTree();
      persistData();
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

      const folderNotes = Object.values(notes).filter((n) => n.folderId === folder.id);
      const count = folderNotes.length;
      const warning = count > 0 
        ? `Delete "${folder.name}" and all ${count} note(s) inside it?` 
        : `Delete "${folder.name}"?`;

      const confirmed = await showConfirmDialog(warning);
      if (!confirmed) return;

      // Collect remote paths for all notes within the folder
      const pathsToDelete = folderNotes.map((n) => getNoteFilePath(n)).filter(Boolean);

      // Local state update
      delete folders[folder.id];
      Object.keys(notes).forEach((nid) => {
        if (notes[nid].folderId === folder.id) delete notes[nid];
      });
      activeNoteId = Object.keys(notes)[0] || null;
      renderTree();
      loadActiveNote();
      persistData();

      // Async batch deletion on GitHub (removes directory automatically)
      if (pathsToDelete.length > 0 && gitConfig) {
        saveStatus.textContent = "Purging folder in Git...";
        for (const filePath of pathsToDelete) {
          await deleteRemoteFile(filePath);
        }
        saveStatus.textContent = "Git synced";
        setTimeout(() => (saveStatus.textContent = "Saved"), 2000);
      }
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

async function deleteRemoteFile(filePath) {
  if (!gitConfig) return;

  const apiBase = `https://api.github.com/repos/${gitConfig.owner}/${gitConfig.repo}/contents/${encodeURIComponent(filePath)}`;
  const headers = {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${gitConfig.token}`,
    "X-GitHub-Api-Version": "2022-11-28"
  };

  try {
    // 1. Fetch current file SHA (required by GitHub to delete)
    const checkRes = await fetch(`${apiBase}?ref=${gitConfig.branch || "main"}&_=${Date.now()}`, {
      method: "GET",
      headers
    });

    if (!checkRes.ok) {
      if (checkRes.status === 404) return; // File wasn't synced yet, nothing to delete
      throw new Error(`Failed checking file SHA: ${checkRes.statusText}`);
    }

    const fileData = await checkRes.json();

    // 2. Send DELETE request
    const delRes = await fetch(apiBase, {
      method: "DELETE",
      headers,
      body: JSON.stringify({
        message: `Delete ${filePath} [Native Notes]`,
        sha: fileData.sha,
        branch: gitConfig.branch || "main"
      })
    });

    if (!delRes.ok) {
      const err = await delRes.json();
      throw new Error(err.message || delRes.statusText);
    }
  } catch (err) {
    console.warn(`Remote deletion failed for ${filePath}:`, err.message);
  }
}

function getNoteFilePath(note) {
  if (!note) return null;
  const folderName = folders[note.folderId]?.name || "General";
  const cleanFolder = folderName.replace(/[/\\?%*:|"<>]/g, "-").trim();
  const cleanTitle = (note.title || "Untitled").replace(/[/\\?%*:|"<>]/g, "-").trim();
  return `${cleanFolder}/${cleanTitle}.md`;
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
  const name = await showPromptDialog({
    title: "New Folder",
    message: "Enter folder name:",
    defaultValue: "New Folder"
  });
  if (!name || !name.trim()) return;

  const fid = "f_" + Date.now();
  folders[fid] = { id: fid, name: name.trim() };
  renderTree();
  persistData();
});

deleteBtn.addEventListener("click", async () => {
  if (!activeNoteId || !notes[activeNoteId]) return;

  const noteToDelete = notes[activeNoteId];
  const currentTitle = noteToDelete.title || "Untitled";
  const confirmed = await showConfirmDialog(`Delete "${currentTitle}"?`);
  if (!confirmed) return;

  // Calculate remote path before removing from memory
  const remotePath = getNoteFilePath(noteToDelete);

  // Local state update
  delete notes[activeNoteId];
  activeNoteId = Object.keys(notes)[0] || null;
  renderTree();
  loadActiveNote();
  persistData();

  // Async remote deletion
  if (remotePath && gitConfig) {
    saveStatus.textContent = "Removing from Git...";
    await deleteRemoteFile(remotePath);
    saveStatus.textContent = "Git synced";
    setTimeout(() => (saveStatus.textContent = "Saved"), 2000);
  }
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

// Secure incoming message gate
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // 1. Origin verification: Must originate from your own extension context
  if (sender.id !== chrome.runtime.id) {
    console.warn("Unauthorized message rejected from sender:", sender);
    return;
  }

  // 2. Action validation
  if (!message || message.action !== "CLIP_NOTE") {
    return;
  }

  // 3. Payload type check
  if (typeof message.content !== "string") {
    console.warn("Malformed clip payload rejected");
    return;
  }

  // 4. Input size limit (cap at 500 KB to avoid memory abuse or API rejections)
  const MAX_CLIP_LENGTH = 500 * 1024;
  const sanitizedContent = message.content.slice(0, MAX_CLIP_LENGTH);
  const noteTitle = (typeof message.title === "string" && message.title.trim()) 
    ? message.title.trim().slice(0, 100) 
    : "Web Clip";

  // Append or create a note with the sanitized payload
  if (activeNoteId && notes[activeNoteId]) {
    notes[activeNoteId].content = (notes[activeNoteId].content || "") + "\n\n" + sanitizedContent;
    loadActiveNote();
    persistData();
  } else {
    const firstFolder = Object.keys(folders)[0] || "f_default";
    const newId = "n_" + Date.now();
    notes[newId] = {
      id: newId,
      folderId: firstFolder,
      title: noteTitle,
      content: `# ${noteTitle}\n\n${sanitizedContent}`,
      updatedAt: Date.now()
    };
    activeNoteId = newId;
    renderTree();
    loadActiveNote();
    persistData();
  }

  sendResponse({ success: true });
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
// Change chrome.storage.sync to chrome.storage.local
// (We include a fallback check for sync so existing notes migrate automatically)
chrome.storage.local.get(["folders", "notes", "activeNoteId"], (res) => {
  if (res.folders && Object.keys(res.folders).length > 0) {
    folders = res.folders;
    notes = res.notes || {};
    activeNoteId = res.activeNoteId && notes[res.activeNoteId] ? res.activeNoteId : Object.keys(notes)[0];
    renderTree();
    loadActiveNote();
  } else {
    // Check old sync storage once to migrate any existing notes
    chrome.storage.sync.get(["folders", "notes", "activeNoteId"], (syncRes) => {
      if (syncRes.folders) {
        folders = syncRes.folders;
        notes = syncRes.notes || {};
        activeNoteId = syncRes.activeNoteId || Object.keys(notes)[0];
        persistData(); // saves them forward into local storage
      } else {
        folders = { f_default: { id: "f_default", name: "General" } };
        notes = {
          n_seed: {
            id: "n_seed",
            folderId: "f_default",
            title: "Welcome Note",
            content: "# Native Notes\n\nStart typing or clip from any tab.",
            updatedAt: Date.now()
          }
        };
        activeNoteId = "n_seed";
      }
      renderTree();
      loadActiveNote();
    });
  }
});