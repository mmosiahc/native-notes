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

function updateExtensionIcon(isDark) {
  const mode = isDark ? "dark" : "light";
  chrome.action.setIcon({
    path: {
      "16": `icons/icon-${mode}-16.png`,
      "32": `icons/icon-${mode}-32.png`
    }
  });
}

// 1. Detect on startup
const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
updateExtensionIcon(mediaQuery.matches);

// 2. React if user toggles system OS theme live
mediaQuery.addEventListener("change", (e) => {
  updateExtensionIcon(e.matches);
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
    modalConfirmBtn.style.display = "block";
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

/**
 * Validating wrapper optimized specifically for note filenames.
 * @returns {Promise<string|null>} Resolves with a valid filename or null
 */
async function promptNoteName({ title = "Note Name", message = "", defaultValue = "" }) {
  // Use your existing Prompt dialog
  const input = await showPromptDialog({ title, message, defaultValue });

  if (input === null) return null; // User cancelled

  // Use Step 2's sanitizer to check the input
  const sanitizedInput = sanitizeFileName(input);

  // If input was just illegal characters or blank, fail gracefully
  if (!sanitizedInput || sanitizedInput.length === 0) {
    await showAlertDialog("Invalid note name. Please use standard characters.", "Invalid Name");
    return null; // Return null so the action (create/rename) stops
  }

  return sanitizedInput;
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
if (gitConfigBtn) {
  gitConfigBtn.addEventListener("click", async () => {
    if (isGitConnected()) {
      const statusDetails =
        `Repository: ${gitConfig.owner}/${gitConfig.repo}\n` +
        `Branch: ${gitConfig.branch || "main"}\n\n` +
        `Choose an action:`;

      const choice = await showCustomDialog({
        title: "Git Integration",
        message: statusDetails,
        showCancel: true,
        cancelLabel: "Close",
        extraBtnLabel: "Options...", // Opens Reconfigure/Disconnect
        confirmLabel: "Sync All to Git"
      });

      if (choice === true) {
        // Trigger Full Reconciliation
        await syncFullTreeToGit();
      } else if (choice === "EXTRA") {
        // Sub-menu for Reconfigure vs Disconnect
        const manageChoice = await showCustomDialog({
          title: "Manage Git Connection",
          message: `Connected to ${gitConfig.owner}/${gitConfig.repo}`,
          showCancel: true,
          cancelLabel: "Back",
          extraBtnLabel: "Disconnect",
          confirmLabel: "Reconfigure"
        });

        if (manageChoice === true) {
          startGitOnboarding();
        } else if (manageChoice === "EXTRA") {
          const confirmed = await showConfirmDialog(
            `Disconnect from ${gitConfig.owner}/${gitConfig.repo}? Local notes will remain.`
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
      }
      return;
    }

    startGitOnboarding();
  });
}


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

const PROTECTED_FILES = [
  "README.md",
  "readme.md"
];

// Helper to check if a path or filename matches protected list
function isProtectedPath(filePath) {
  const fileName = filePath.split("/").pop();
  return PROTECTED_FILES.includes(fileName) || PROTECTED_FILES.includes(filePath);
}

/**
 * Full Tree Sync:
 * 1. Queries GitHub's Git Trees API recursively to see all existing remote .md files.
 * 2. Pushes/updates all local notes to their current folder paths.
 * 3. Deletes any remote files that have been removed or moved locally (except protected files).
 */
async function syncFullTreeToGit() {
  if (!isGitConnected()) return;

  saveStatus.textContent = "Syncing full tree...";
  isGitSyncing = true;

  const headers = {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${gitConfig.token}`,
    "X-GitHub-Api-Version": "2022-11-28"
  };

  try {
    const branch = gitConfig.branch || "main";

    // 1. Fetch the recursive tree of the repository
    const treeUrl = `https://api.github.com/repos/${gitConfig.owner}/${gitConfig.repo}/git/trees/${branch}?recursive=1`;
    const treeRes = await fetch(treeUrl, { headers });

    let remoteFiles = {}; // Maps filePath -> blob SHA
    if (treeRes.ok) {
      const treeData = await treeRes.json();
      (treeData.tree || []).forEach((item) => {
        // Exclude protected files right away so they are never touched
        if (item.type === "blob" && item.path.endsWith(".md") && !isProtectedPath(item.path)) {
          remoteFiles[item.path] = item.sha;
        }
      });
    }

    // 2. Build local desired file path map
    // Maps filePath -> note object
    const localFiles = {};
    Object.values(notes).forEach((note) => {
      const path = getNoteFilePath(note);
      if (path && !isProtectedPath(path)) localFiles[path] = note;
    });

    // 3. Delete remote files that do not exist locally
    for (const [remotePath, sha] of Object.entries(remoteFiles)) {
      if (!localFiles[remotePath] && !isProtectedPath(remotePath)) {
        saveStatus.textContent = `Deleting ${remotePath}...`;
        await deleteRemoteFile(remotePath);
      }
    }

    // 4. Push/Update all local notes
    for (const [filePath, note] of Object.entries(localFiles)) {
      saveStatus.textContent = `Syncing ${note.title}...`;
      const apiBase = `https://api.github.com/repos/${gitConfig.owner}/${gitConfig.repo}/contents/${encodeURIComponent(filePath)}`;

      // Check current remote SHA for this specific path
      let fileSha = remoteFiles[filePath] || null;

      const contentPayload = note.content || `# ${note.title}\n`;
      const base64Content = btoa(unescape(encodeURIComponent(contentPayload)));

      await fetch(apiBase, {
        method: "PUT",
        headers,
        body: JSON.stringify({
          message: `Sync ${filePath} [Native Notes]`,
          content: base64Content,
          sha: fileSha || undefined,
          branch: branch
        })
      });
    }

    saveStatus.textContent = "Tree fully synced";
    setTimeout(() => (saveStatus.textContent = "Saved"), 2500);
  } catch (err) {
    console.error("Full tree sync failed:", err);
    saveStatus.textContent = "Sync error";
  } finally {
    isGitSyncing = false;
  }
}

// --- Selectors ---
const importFilesInput = document.getElementById("import-files-input");
const importFolderInput = document.getElementById("import-folder-input");
const importFilesBtn = document.getElementById("import-files-btn");
const importFolderBtn = document.getElementById("import-folder-btn");

// Trigger file picker
if (importFilesBtn) {
  importFilesBtn.addEventListener("click", () => {
    importFilesInput.value = "";
    importFilesInput.click();
  });
}


// Trigger directory picker
if (importFolderBtn) {
  importFolderBtn.addEventListener("click", () => {
    importFolderInput.value = "";
    importFolderInput.click();
  });
}

// Listener for single or multiple individual files
importFilesInput.addEventListener("change", (e) => {
  handleIncomingFiles(Array.from(e.target.files), false);
});

// Listener for folder directory
importFolderInput.addEventListener("change", (e) => {
  handleIncomingFiles(Array.from(e.target.files), true);
});

// --- Helper: Find or Create Folder Safely ---
function getOrCreateFolderId(folderName) {
  const trimmed = (folderName || "General").trim();

  // Check if a folder with this name (case-insensitive) already exists
  const existing = Object.values(folders).find(
    (f) => f && f.name && f.name.toLowerCase() === trimmed.toLowerCase()
  );
  if (existing) return existing.id;

  // If not found, create a new valid folder entry in memory!
  const newFolderId = "f_" + Date.now() + "_" + Math.random().toString(36).substring(2, 6);
  folders[newFolderId] = {
    id: newFolderId,
    name: trimmed
  };
  return newFolderId;
}

// --- Shared File / Folder Processor ---
async function handleIncomingFiles(fileList, isDirectory) {
  // 1. Filter markdown files, ignore hidden directories (like .git, .obsidian)
  const mdFiles = fileList.filter((f) => {
    const isMd = f.name.toLowerCase().endsWith(".md");
    const path = f.webkitRelativePath || f.name;
    const isHidden = path.split("/").some((part) => part.startsWith("."));
    return isMd && !isHidden;
  });

  if (!mdFiles.length) {
    alert("No markdown (.md) files found.");
    return;
  }

  saveStatus.textContent = `Importing ${mdFiles.length} file(s)...`;

  try {
    let firstImportedNoteId = null;

    for (const file of mdFiles) {
      let targetFolderName = "General";

      if (isDirectory && file.webkitRelativePath) {
        const parts = file.webkitRelativePath.split("/");
        if (parts.length > 2) {
          // Nested: RootDir/SubFolder/.../file.md -> SubFolder
          targetFolderName = parts[1];
        } else if (parts.length === 2) {
          // Direct child: RootDir/file.md -> RootDir
          targetFolderName = parts[0];
        }
      } else {
        // Single file import: use active note's folder name if available
        if (activeNoteId && notes[activeNoteId] && folders[notes[activeNoteId].folderId]) {
          targetFolderName = folders[notes[activeNoteId].folderId].name;
        }
      }

      const folderId = getOrCreateFolderId(targetFolderName);
      const noteTitle = file.name.replace(/\.md$/i, "").trim() || "Untitled Note";
      const textContent = await file.text();

      const noteId = "note_" + Date.now() + "_" + Math.random().toString(36).substring(2, 7);
      notes[noteId] = {
        id: noteId,
        title: noteTitle,
        content: textContent,
        folderId: folderId,
        updatedAt: Date.now()
      };

      if (!firstImportedNoteId) {
        firstImportedNoteId = noteId;
      }
    }

    // Set active note so the folder stays open and displays the note
    if (firstImportedNoteId) {
      activeNoteId = firstImportedNoteId;
    }

    // Persist both folders and notes to storage
    await chrome.storage.local.set({ folders, notes, activeNoteId });

    // Refresh UI tree & editor view
    renderTree();
    loadActiveNote();

    saveStatus.textContent = `Imported ${mdFiles.length} note(s)`;
    setTimeout(() => (saveStatus.textContent = "Saved"), 2500);

    // Sync to Git if connected
    if (typeof syncFullTreeToGit === "function" && isGitConnected()) {
      syncFullTreeToGit();
    }
  } catch (err) {
    console.error("Import error:", err);
    saveStatus.textContent = "Import failed";
    alert(`Import failed: ${err.message}`);
  }
}

async function moveNoteToFolder(noteId, targetFolderId) {
  const note = notes[noteId];
  if (!note || note.folderId === targetFolderId) return;

  const oldPath = getNoteFilePath(note);
  const oldFolderId = note.folderId;

  // 1. Update local state
  note.folderId = targetFolderId;
  note.updatedAt = Date.now();
  activeNoteId = note.id;

  // 2. Persist locally
  await chrome.storage.local.set({ notes, activeNoteId });
  renderTree();
  loadActiveNote();

  // 3. Reconcile on GitHub
  if (isGitConnected() && oldPath) {
    saveStatus.textContent = "Moving note in Git...";
    try {
      // Delete from previous folder on remote
      await deleteRemoteFile(oldPath);
      // Sync file to the new destination path
      await syncActiveNoteToGit();
      saveStatus.textContent = "Git synced";
      setTimeout(() => (saveStatus.textContent = "Saved"), 2000);
    } catch (err) {
      console.error("Git move failed:", err);
      saveStatus.textContent = "Move error";
    }
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

    // --- DROP TARGET: Folder Header ---
    header.addEventListener("dragover", (e) => {
      e.preventDefault(); // Required to allow drop
      e.dataTransfer.dropEffect = "move";
      header.classList.add("drag-over");
    });

    header.addEventListener("dragleave", () => {
      header.classList.remove("drag-over");
    });

    header.addEventListener("drop", async (e) => {
      e.preventDefault();
      header.classList.remove("drag-over");

      const droppedNoteId = e.dataTransfer.getData("text/plain");
      if (droppedNoteId && notes[droppedNoteId]) {
        folderGroup.classList.remove("collapsed");
        await moveNoteToFolder(droppedNoteId, folder.id);
      }
    });

    // Click folder header to toggle collapse / expand
    header.addEventListener("click", () => {
      folderGroup.classList.toggle("collapsed");
    });

    // Double-click folder name to rename
    const folderLabel = header.querySelector(".folder-label");
    folderLabel.addEventListener("dblclick", async (e) => {
      e.stopPropagation();

      const updatedName = await showPromptDialog({
        title: "Rename Folder",
        message: "Enter new folder name:",
        defaultValue: folder.name
      });

      if (!updatedName || !updatedName.trim() || updatedName.trim() === folder.name) {
        return;
      }

      const oldFolderName = folder.name;
      const newFolderName = updatedName.trim();

      // 1. Gather all old remote paths before updating state
      const folderNotes = Object.values(notes).filter((n) => n.folderId === folder.id);
      const oldPaths = folderNotes.map((n) => getNoteFilePath(n)).filter(Boolean);

      // 2. Update local state
      folders[folder.id].name = newFolderName;
      renderTree();
      persistData();

      // 3. Move on GitHub (Delete old paths, then push new paths)
      if (gitConfig && oldPaths.length > 0) {
        saveStatus.textContent = "Moving folder in Git...";
        for (const oldPath of oldPaths) {
          await deleteRemoteFile(oldPath);
        }
        // Re-push notes under the new folder path
        await syncFullTreeToGit();
      }
    });


    // Add note button inside folder header
    const addNoteBtn = header.querySelector(".add-note-in-folder");
    if (addNoteBtn) {
      addNoteBtn.addEventListener("click", async (e) => {
        e.stopPropagation(); // CRITICAL: stops header from collapsing/toggling

        folderGroup.classList.remove("collapsed");

        const noteTitle = await promptNoteName({
          title: "New Note",
          message: `Create note in "${folder.name}":`,
          defaultValue: "New Note"
        });

        if (!noteTitle) return;

        createNote(folder.id, noteTitle);
      });
    }

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
      // 1. Create container for note item and actions
      const itemContainer = document.createElement("div");
      itemContainer.className = `note-item ${note.id === activeNoteId ? "active" : ""}`;

      // --- DRAGGABLE SOURCE: Note Item ---
      itemContainer.draggable = true;

      let isDragging  = false;

      itemContainer.addEventListener("dragstart", (e) => {
        isDragging = true;
        e.stopPropagation();
        e.dataTransfer.setData("text/plain", note.id);
        e.dataTransfer.effectAllowed = "move";
        itemContainer.classList.add("dragging");
      });

      itemContainer.addEventListener("dragend", () => {
        itemContainer.classList.remove("dragging");
        // Reset asynchronously after click queue finishes processing
        setTimeout(() => {
          isDragging = false;
        }, 50);
      });

      // Click to select the note
      itemContainer.addEventListener("click", () => {
        if (isDragging) return; // Prevent selection if just finished dragging
        if (activeNoteId === note.id) return;

        activeNoteId = note.id;
        renderTree();
        loadActiveNote();
        persistData();
      });

      // Note label
      const titleLabel = document.createElement("span");
      titleLabel.className = "note-title-label";
      titleLabel.textContent = note.title || "Untitled";
      itemContainer.appendChild(titleLabel);

     // Actions container with ellipsis
      const noteActions = document.createElement("div");
      noteActions.className = "note-actions";

      // 4. Combined More Options (Ellipsis) Button
      const moreBtn = document.createElement("button");
      moreBtn.className = "note-more-btn";
      moreBtn.innerHTML = "&#8942;"; // Vertical ellipsis ⋮
      moreBtn.title = "Note actions";

      // Prevent row drag or selection when interacting with the button
      moreBtn.addEventListener("mousedown", (e) => e.stopPropagation());
      moreBtn.addEventListener("click", async (e) => {
        e.stopPropagation();

        // Show modal with action choices
        const action = await showCustomDialog({
          title: note.title || "Note Options",
          message: "Choose an action for this note:",
          showCancel: true,
          cancelLabel: "Cancel",
          extraBtnLabel: "Move to...", // Secondary action
          confirmLabel: "Rename"       // Primary action
        });

        // 1. Rename Action
        if (action === true) {
          const newName = await promptNoteName({
            title: "Rename Note",
            message: `Enter new name for "${note.title}":`,
            defaultValue: note.title
          });

          if (!newName || newName === note.title) return;

          if (isGitConnected()) {
            saveStatus.textContent = "Renaming on Git...";
            const oldRemotePath = getNoteFilePath(note);
            if (oldRemotePath) await deleteRemoteFile(oldRemotePath);

            notes[note.id].title = newName;
            notes[note.id].updatedAt = Date.now();
            await syncActiveNoteToGit();
          } else {
            notes[note.id].title = newName;
            notes[note.id].updatedAt = Date.now();
          }

          renderTree();
          persistData();
        }

        // 2. Move Action
        else if (action === "EXTRA") {
          const currentFolderName = folders[note.folderId]?.name || "General";
          const folderNames = Object.values(folders).map((f) => f.name).join(", ");

          const targetName = await showPromptDialog({
            title: "Move Note",
            message: `Current: "${currentFolderName}"\nAvailable: ${folderNames}\n\nEnter target folder:`,
            defaultValue: currentFolderName
          });

          if (!targetName || !targetName.trim() || targetName.trim() === currentFolderName) {
            return;
          }

          const targetFolderId = getOrCreateFolderId(targetName.trim());
          await moveNoteToFolder(note.id, targetFolderId);
        }
      });

      noteActions.appendChild(moreBtn);
      itemContainer.appendChild(noteActions);
      noteList.appendChild(itemContainer);
    });

    folderGroup.appendChild(noteList);
    treeContainer.appendChild(folderGroup);
  });
}

async function exportAllNotesToZip() {
  const noteList = Object.values(notes);
  if (!noteList.length) {
    alert("No notes available to export.");
    return;
  }

  if (typeof JSZip === "undefined") {
    alert("JSZip library not found. Please ensure jszip.min.js is included.");
    return;
  }

  saveStatus.textContent = "Generating ZIP archive...";

  const zip = new JSZip();

  for (const note of noteList) {
    const folder = folders[note.folderId];
    const folderName = (folder ? folder.name : "General").replace(/[\\/:*?"<>|]/g, "_").trim();
    const fileName = `${(note.title || "Untitled").replace(/[\\/:*?"<>|]/g, "_").trim()}.md`;
    const content = note.content || `# ${note.title}\n`;

    zip.folder(folderName).file(fileName, content);
  }

  try {
    const zipBlob = await zip.generateAsync({ type: "blob" });
    const downloadUrl = URL.createObjectURL(zipBlob);

    const link = document.createElement("a");
    const dateStr = new Date().toISOString().split("T")[0];
    link.download = `native-notes-backup-${dateStr}.zip`;
    link.href = downloadUrl;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    URL.revokeObjectURL(downloadUrl);

    saveStatus.textContent = "Exported to ZIP";
    setTimeout(() => (saveStatus.textContent = "Saved"), 2500);
  } catch (err) {
    console.error("ZIP export failed:", err);
    saveStatus.textContent = "Export error";
  }
}

const MANAGE_ICONS = {
  // Markdown / Document Icon
  file: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
    <polyline points="14 2 14 8 20 8"></polyline>
    <line x1="16" y1="13" x2="8" y2="13"></line>
    <line x1="16" y1="17" x2="8" y2="17"></line>
    <line x1="10" y1="9" x2="8" y2="9"></line>
  </svg>`,

  // Folder Directory Icon
  folder: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
  </svg>`,

  // ZIP / Archive Box Icon
  archive: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <polyline points="21 8 21 21 3 21 3 8"></polyline>
    <rect x="1" y="3" width="22" height="5"></rect>
    <line x1="10" y1="12" x2="14" y2="12"></line>
  </svg>`,

  // Official GitHub Invertocat Logo
  git: `<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
    <path fill-rule="evenodd" clip-rule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"/>
  </svg>`
};

// Generic list-selection modal builder
function showMenuDialog({ title = "Manage Notes", options = [] }) {
  return new Promise((resolve) => {
    modalTitle.textContent = title;
    modalTitle.style.display = "block";

    // Build the clickable items inside modalMsg container
    modalMsg.style.display = "block";
    modalMsg.innerHTML = "";

    const listContainer = document.createElement("div");
    listContainer.className = "manage-menu-list";

    options.forEach((opt) => {
      const btn = document.createElement("button");
      btn.className = "manage-menu-item";
      
      const iconSpan = document.createElement("span");
      iconSpan.className = "menu-icon";
      iconSpan.innerHTML = opt.iconSvg || opt.icon || "";

      const labelSpan = document.createElement("span");
      labelSpan.textContent = opt.label;

      btn.appendChild(iconSpan);
      btn.appendChild(labelSpan);

      btn.addEventListener("click", () => {
        cleanup();
        resolve(opt.id);
      });
      listContainer.appendChild(btn);
    });

    modalMsg.appendChild(listContainer);

    modalInput.style.display = "none";
    modalConfirmBtn.style.display = "none";
    modalExtraBtn.style.display = "none";

    modalCancelBtn.style.display = "block";
    modalCancelBtn.textContent = "Close";

    modalOverlay.classList.add("open");

    const cleanup = () => {
      modalOverlay.classList.remove("open");
      modalCancelBtn.removeEventListener("click", onCancel);
      window.removeEventListener("keydown", onKey);
      modalMsg.innerHTML = ""; // Clear dynamic list items

      //Reset button visibility for future dialogs
      if (modalConfirmBtn) modalConfirmBtn.style.display = "";
      if (modalExtraBtn) modalExtraBtn.style.display = "none";
    };

    const onCancel = () => {
      cleanup();
      resolve(null);
    };

    const onKey = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      }
    };

    modalCancelBtn.addEventListener("click", onCancel);
    window.addEventListener("keydown", onKey);
  });
}

// Manage Notes Button Listener
const manageNotesBtn = document.getElementById("manage-notes-btn");

if (manageNotesBtn) {
  manageNotesBtn.addEventListener("click", async () => {
    const gitLabel = isGitConnected()
      ? `GitHub Sync (${gitConfig.repo})`
      : "Connect GitHub...";

    const choice = await showMenuDialog({
      title: "Manage Notes",
      options: [
        { id: "import-files", iconSvg: MANAGE_ICONS.file, label: "Import Markdown Files" },
        { id: "import-folder", iconSvg: MANAGE_ICONS.folder, label: "Import Directory" },
        { id: "export-zip", iconSvg: MANAGE_ICONS.archive, label: "Export Notes" },
        { id: "git-sync", iconSvg: MANAGE_ICONS.git, label: gitLabel }
      ]
    });

    if (!choice) return;

    switch (choice) {
      case "import-files":
        if (importFilesInput) {
          importFilesInput.value = "";
          importFilesInput.click();
        }
        break;

      case "import-folder":
        if (importFolderInput) {
          importFolderInput.value = "";
          importFolderInput.click();
        }
        break;

      case "export-zip":
        // Trigger existing ZIP export logic
        exportAllNotesToZip();
        break;

      case "git-sync":
        // Trigger existing Git flow
        if (isGitConnected()) {
          const gitChoice = await showCustomDialog({
            title: "Git Integration",
            message: `Repository: ${gitConfig.owner}/${gitConfig.repo}\nBranch: ${gitConfig.branch || "main"}`,
            showCancel: true,
            cancelLabel: "Close",
            extraBtnLabel: "Options...",
            confirmLabel: "Sync All to Git"
          });

          if (gitChoice === true) {
            await syncFullTreeToGit();
          } else if (gitChoice === "EXTRA") {
            const manageChoice = await showCustomDialog({
              title: "Manage Git Connection",
              message: `Connected to ${gitConfig.owner}/${gitConfig.repo}`,
              showCancel: true,
              cancelLabel: "Back",
              extraBtnLabel: "Disconnect",
              confirmLabel: "Reconfigure"
            });

            if (manageChoice === true) {
              startGitOnboarding();
            } else if (manageChoice === "EXTRA") {
              const confirmed = await showConfirmDialog(
                `Disconnect from ${gitConfig.owner}/${gitConfig.repo}? Local notes will remain.`
              );
              if (confirmed) {
                gitConfig = null;
                await chrome.storage.local.remove("gitConfig");
                if (gitIndicator) gitIndicator.style.display = "none";
                if (gitStatusText) gitStatusText.textContent = "";
                saveStatus.textContent = "Git disconnected";
                setTimeout(() => (saveStatus.textContent = "Saved"), 2000);
              }
            }
          }
        } else {
          startGitOnboarding();
        }
        break;
    }
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

// Strips characters that break Git filenames and GitHub URLs
function sanitizeFileName(name) {
  return name
    .trim()
    .replace(/[/\\?%*:|"<>]/g, '-') // Replace illegal characters
    .trim()
    .slice(0, 50);                  // Good URL hygiene limit
}

// Generates the deterministic path on GitHub
function getNoteFilePath(note) {
  if (!note || !folders[note.folderId]) return null;

  const folderName = folders[note.folderId].name || "General";
  
  // Use the sanitizer for both the folder and title
  const cleanFolder = sanitizeFileName(folderName);
  const cleanTitle = sanitizeFileName(note.title || "Untitled");
  
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