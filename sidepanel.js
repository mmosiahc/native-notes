const notesArea = document.getElementById("notes");
const statusDiv = document.getElementById("status");

// 1. Load saved notes on open
chrome.storage.sync.get(["userNotes"], (result) => {
  if (result.userNotes) {
    notesArea.value = result.userNotes;
  }
});

// 2. Debounced auto-save on input
let timeoutId;
notesArea.addEventListener("input", () => {
  statusDiv.textContent = "Saving...";
  clearTimeout(timeoutId);

  timeoutId = setTimeout(() => {
    chrome.storage.sync.set({ userNotes: notesArea.value }, () => {
      statusDiv.textContent = "Saved";
    });
  }, 400);
});