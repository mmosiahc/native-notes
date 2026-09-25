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

      // 2. Clickable area for note name
      const titleLabel = document.createElement("span");
      titleLabel.className = "note-title-label";
      titleLabel.textContent = note.title || "Untitled";

      titleLabel.addEventListener("click", (e) => {
        e.stopPropagation();
        activeNoteId = note.id;
        renderTree();
        loadActiveNote();
        persistData();
      });
      
      itemContainer.appendChild(titleLabel);

      // 3. New Action Button Area (hidden until hover)
      const noteActions = document.createElement("div");
      noteActions.className = "note-actions";

      // 4. ADD the "Rename Note" button
      const renameBtn = document.createElement("button");
      renameBtn.className = "icon-btn-sm rename-note";
      renameBtn.innerHTML = "✎"; // or use an SVG
      renameBtn.title = "Rename Note";

      // --- ADD the click handler that invokes the Step 3 dialog and Step 2 fix ---
      renameBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        
        // Use Step 3's validated prompt
        const newName = await promptNoteName({
          title: "Rename Note",
          message: `Change filename for "${note.title}"?`,
          defaultValue: note.title
        });

        // Fail conditions: cancel, same name, or blank name
        if (!newName || newName === note.title) return;

        // --- THE GIT FIX: Atomic Rename Operation ---
        if (gitConfig) {
          saveStatus.textContent = "Renaming on Git...";

          // a. Calculate the current (old) file path
          const oldRemotePath = getNoteFilePath(note);

          // b. Delete the old file path on GitHub
          if (oldRemotePath) {
            await deleteRemoteFile(oldRemotePath);
          }
          
          // c. Reset local title state in memory
          notes[note.id].title = newName;
          notes[note.id].updatedAt = Date.now();

          // d. Force immediate sync (it will sync content to the NEW path from Step b)
          await syncActiveNoteToGit();
        } else {
          // If Git isn't connected, just update memory
          notes[note.id].title = newName;
          notes[note.id].updatedAt = Date.now();
        }

        renderTree(); // Refresh labels
        persistData(); // Saves memory update (e.g. updatedAt)
      });
      
      noteActions.appendChild(renameBtn);
      itemContainer.appendChild(noteActions);
      noteList.appendChild(itemContainer);
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