(function () {
  // Prevent duplicate injections
  if (document.getElementById("my-floating-notes-host")) return;

  // 1. Create Host Element and attach Shadow DOM
  const host = document.createElement("div");
  host.id = "my-floating-notes-host";
  document.documentElement.appendChild(host);

  const shadow = host.attachShadow({ mode: "open" });

  // 2. Inject Scoped Styles and Markup inside Shadow DOM
  shadow.innerHTML = `
    <style>
      :host {
        all: initial;
      }
      #dock {
        position: fixed;
        bottom: 24px;
        right: 24px;
        width: 280px;
        height: 220px;
        background: #ffffff;
        border-radius: 12px;
        box-shadow: 0 10px 25px rgba(0, 0, 0, 0.15), 0 2px 6px rgba(0, 0, 0, 0.08);
        border: 1px solid #e5e7eb;
        display: flex;
        flex-direction: column;
        overflow: hidden;
        z-index: 2147483647; /* Highest z-index */
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        box-sizing: border-box;
      }
      #dock-header {
        background: #f8fafc;
        padding: 8px 12px;
        cursor: grab;
        display: flex;
        align-items: center;
        justify-content: space-between;
        border-bottom: 1px solid #e2e8f0;
        user-select: none;
      }
      #dock-header:active {
        cursor: grabbing;
      }
      .title {
        font-size: 12px;
        font-weight: 600;
        color: #475569;
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .actions {
        display: flex;
        gap: 6px;
      }
      .btn {
        background: transparent;
        border: none;
        cursor: pointer;
        font-size: 14px;
        color: #94a3b8;
        padding: 0;
        line-height: 1;
      }
      .btn:hover {
        color: #334155;
      }
      #dock-content {
        flex: 1;
        display: flex;
        flex-direction: column;
        padding: 8px;
        background: #fff;
      }
      textarea {
        flex: 1;
        width: 100%;
        border: none;
        outline: none;
        resize: none;
        font-size: 13px;
        color: #1e293b;
        box-sizing: border-box;
        font-family: inherit;
      }
      .collapsed {
        height: 38px !important;
        width: 140px !important;
      }
      .collapsed #dock-content {
        display: none;
      }
    </style>

    <div id="dock">
      <div id="dock-header">
        <div class="title">
          <span>📝 Notes</span>
        </div>
        <div class="actions">
          <button id="min-btn" class="btn" title="Minimize">−</button>
        </div>
      </div>
      <div id="dock-content">
        <textarea id="dock-notes" placeholder="Quick note..."></textarea>
      </div>
    </div>
  `;

  const dock = shadow.getElementById("dock");
  const header = shadow.getElementById("dock-header");
  const textarea = shadow.getElementById("dock-notes");
  const minBtn = shadow.getElementById("min-btn");

  // 3. Load & Auto-Save Note Content
  chrome.storage.sync.get(["userNotes"], (res) => {
    if (res.userNotes) textarea.value = res.userNotes;
  });

  let saveTimer;
  textarea.addEventListener("input", () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      chrome.storage.sync.set({ userNotes: textarea.value });
    }, 400);
  });

  // Listen for sync updates if modified from the side panel
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "sync" && changes.userNotes) {
      textarea.value = changes.userNotes.newValue || "";
    }
  });

  // 4. Minimize / Expand Toggle
  let isMinimized = false;
  minBtn.addEventListener("click", () => {
    isMinimized = !isMinimized;
    dock.classList.toggle("collapsed", isMinimized);
    minBtn.textContent = isMinimized ? "+" : "−";
  });

  // 5. Draggable Handling
  let isDragging = false;
  let offsetX = 0;
  let offsetY = 0;

  header.addEventListener("mousedown", (e) => {
    isDragging = true;
    const rect = dock.getBoundingClientRect();
    offsetX = e.clientX - rect.left;
    offsetY = e.clientY - rect.top;

    // Switch from bottom/right relative CSS to direct top/left positioning
    dock.style.right = "auto";
    dock.style.bottom = "auto";
    dock.style.left = `${rect.left}px`;
    dock.style.top = `${rect.top}px`;
  });

  document.addEventListener("mousemove", (e) => {
    if (!isDragging) return;

    let newX = e.clientX - offsetX;
    let newY = e.clientY - offsetY;

    // Keep within window viewport boundaries
    newX = Math.max(8, Math.min(window.innerWidth - dock.offsetWidth - 8, newX));
    newY = Math.max(8, Math.min(window.innerHeight - dock.offsetHeight - 8, newY));

    dock.style.left = `${newX}px`;
    dock.style.top = `${newY}px`;
  });

  document.addEventListener("mouseup", () => {
    isDragging = false;
  });
})();