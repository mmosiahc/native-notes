(function () {
  const HOST_ID = "speechify-style-dock-host";
  let host = document.getElementById(HOST_ID);

  // Toggle visibility if already initialized
  if (host) {
    host.style.display = host.style.display === "none" ? "block" : "none";
    ensureInViewport();
    return;
  }

  // 1. Create root host element
  host = document.createElement("div");
  host.id = HOST_ID;
  host.style.cssText = "all: initial; position: static; z-index: 2147483647;";
  (document.body || document.documentElement).appendChild(host);

 const shadow = host.attachShadow({ mode: "open" });

  shadow.innerHTML = `
    <style>
      :host {
        all: initial;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      }
      * {
        box-sizing: border-box;
      }

      /* Floating Capsule Container */
      #pill-dock {
        position: fixed !important;
        top: 40%;
        right: 16px;
        width: 38px;
        background: #ffffff;
        border-radius: 9999px;
        padding: 8px 4px;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 6px;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.12), 0 1px 4px rgba(0, 0, 0, 0.06);
        border: 1px solid rgba(0, 0, 0, 0.08);
        z-index: 2147483647 !important;
        user-select: none;
        backdrop-filter: blur(8px);
        transition: background 0.2s ease, border-color 0.2s ease;
      }

      /* Dark Mode for Dock */
      @media (prefers-color-scheme: dark) {
        #pill-dock {
          background: #1e293b;
          border-color: #334155;
          box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4), 0 1px 4px rgba(0, 0, 0, 0.2);
        }
        .drag-grip {
          background: #475569;
        }
        .drag-grip:hover {
          background: #64748b;
        }
        .pill-btn {
          color: #94a3b8;
        }
        .pill-btn:hover {
          background: #334155;
          color: #22c55e;
        }
        .pill-btn.primary {
          background: rgba(34, 197, 94, 0.15);
          color: #22c55e;
        }
        .pill-btn.primary:hover {
          background: #22c55e;
          color: #09090b;
        }
      }

      /* Subtle drag grip at the top */
      .drag-grip {
        width: 14px;
        height: 3px;
        background: #d1d5db;
        border-radius: 2px;
        cursor: grab;
        margin-bottom: 2px;
        transition: background 0.2s ease;
      }
      .drag-grip:hover {
        background: #9ca3af;
      }
      #pill-dock:active .drag-grip {
        cursor: grabbing;
      }

      /* Icon Buttons */
      .icon-btn-wrapper {
        position: relative;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .pill-btn {
        width: 30px;
        height: 30px;
        border-radius: 50%;
        border: none;
        background: transparent;
        color: #4b5563;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        transition: all 0.18s cubic-bezier(0.16, 1, 0.3, 1);
        padding: 0;
      }

      .pill-btn:hover {
        background: #f3f4f6;
        color: #16a34a;
        transform: scale(1.05);
      }

      .pill-btn:active {
        transform: scale(0.95);
      }

      /* Light Mode Primary Button */
      .pill-btn.primary {
        background: #f0fdf4;
        color: #16a34a;
      }

      .pill-btn.primary:hover {
        background: #22c55e;
        color: #09090b;
      }

      /* Tooltips (fly out to the left) */
      .tooltip {
        position: absolute;
        right: calc(100% + 10px);
        top: 50%;
        transform: translateY(-50%) translateX(4px);
        background: #111827;
        color: #ffffff;
        font-size: 11px;
        font-weight: 500;
        padding: 4px 8px;
        border-radius: 6px;
        white-space: nowrap;
        pointer-events: none;
        opacity: 0;
        transition: opacity 0.15s ease, transform 0.15s ease;
        box-shadow: 0 4px 10px rgba(0, 0, 0, 0.15);
      }

      .tooltip::after {
        content: "";
        position: absolute;
        left: 100%;
        top: 50%;
        margin-top: -4px;
        border-width: 4px;
        border-style: solid;
        border-color: transparent transparent transparent #111827;
      }

      .icon-btn-wrapper:hover .tooltip {
        opacity: 1;
        transform: translateY(-50%) translateX(0);
      }
    </style>

    <div id="pill-dock">
      <div class="drag-grip" title="Drag to move"></div>

      <!-- Button 1: Open Notes Sidebar -->
      <div class="icon-btn-wrapper">
        <button id="open-sidebar-btn" class="pill-btn primary" aria-label="Open Notes">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M8 3.333v9.334M3.333 8h9.334" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
        <span class="tooltip">Notes Sidebar</span>
      </div>

      <!-- Button 2: Quick Copy / Scratch -->
      <div class="icon-btn-wrapper">
        <button id="quick-copy-btn" class="pill-btn" aria-label="Copy Current URL">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
          </svg>
        </button>
        <span class="tooltip">Copy Tab Link</span>
      </div>
    </div>
  `;

  const dock = shadow.getElementById("pill-dock");
  const openSidebarBtn = shadow.getElementById("open-sidebar-btn");
  const quickCopyBtn = shadow.getElementById("quick-copy-btn");
  const dragGrip = shadow.querySelector(".drag-grip");

  // Keep dock on-screen when window splits or resizes
  function ensureInViewport() {
    const rect = dock.getBoundingClientRect();
    const maxTop = window.innerHeight - dock.offsetHeight - 8;
    const maxLeft = window.innerWidth - dock.offsetWidth - 8;

    // If pushed off screen horizontally
    if (rect.right > window.innerWidth || rect.left < 8) {
      dock.style.setProperty("left", "auto", "important");
      dock.style.setProperty("right", "16px", "important");
    }

    // If pushed off screen vertically
    if (rect.top > maxTop || rect.top < 8) {
      dock.style.setProperty("top", `${Math.max(8, Math.min(maxTop, rect.top))}px`, "important");
    }
  }

  window.addEventListener("resize", ensureInViewport);

  // 2. Open Sidebar on primary button click
  openSidebarBtn.addEventListener("click", async (e) => {
    e.preventDefault();
    e.stopPropagation();

    if (!chrome.runtime?.id) {
      console.warn("Extension context invalidated. Please refresh the page.");
      return;
    }

    try {
      await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({ action: "OPEN_SIDE_PANEL" }, (res) => {
          if (chrome.runtime.lastError) {
            return reject(chrome.runtime.lastError);
          }
          resolve(res);
        });
      });
    } catch (err) {
      console.warn("Side panel open request:", err.message || err);
    }
  });

  // 3. Quick Copy URL
  quickCopyBtn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      const tip = quickCopyBtn.nextElementSibling;
      const prev = tip.textContent;
      tip.textContent = "Copied!";
      setTimeout(() => (tip.textContent = prev), 1500);
    } catch (err) {
      console.error(err);
    }
  });

  // 4. Viewport-Aware Dragging
  let isDragging = false;
  let offsetY = 0;
  let offsetX = 0;

  const startDrag = (e) => {
    if (e.target.closest(".pill-btn")) return;
    isDragging = true;
    const rect = dock.getBoundingClientRect();
    offsetY = e.clientY - rect.top;
    offsetX = e.clientX - rect.left;
  };

  dragGrip.addEventListener("mousedown", startDrag);
  dock.addEventListener("mousedown", startDrag);

  document.addEventListener("mousemove", (e) => {
    if (!isDragging) return;

    let newY = e.clientY - offsetY;
    let newX = e.clientX - offsetX;

    // Viewport containment bounds
    newY = Math.max(8, Math.min(window.innerHeight - dock.offsetHeight - 8, newY));
    newX = Math.max(8, Math.min(window.innerWidth - dock.offsetWidth - 8, newX));

    // Anchor relative to right edge if in the right half of the screen
    if (newX > window.innerWidth / 2) {
      const rightDistance = window.innerWidth - (newX + dock.offsetWidth);
      dock.style.setProperty("left", "auto", "important");
      dock.style.setProperty("right", `${Math.max(8, rightDistance)}px`, "important");
    } else {
      dock.style.setProperty("right", "auto", "important");
      dock.style.setProperty("left", `${newX}px`, "important");
    }

    dock.style.setProperty("top", `${newY}px`, "important");
  });

  document.addEventListener("mouseup", () => {
    isDragging = false;
  });

  // 5. Toggle via Extension Icon
  chrome.runtime.onMessage.addListener((message) => {
    if (message.action === "TOGGLE_DOCK") {
      host.style.display = host.style.display === "none" ? "block" : "none";
      ensureInViewport();
    }
  });
})();