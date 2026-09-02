// Ensure panel does not open on action click (only dock toggles)
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: false })
  .catch((err) => console.error(err));

// 1. Toolbar icon toggles or injects the floating dock
chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { action: "TOGGLE_DOCK" });
  } catch {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["content.js"]
    });
  }
});

// 2. Open side panel on request from content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "OPEN_SIDE_PANEL") {
    const tabId = sender.tab?.id;
    const windowId = sender.tab?.windowId;

    if (!tabId && !windowId) {
      sendResponse({ status: "error", message: "No tab or window context" });
      return false;
    }

    // Attempt tab-scoped opening first, then window fallback
    const target = tabId ? { tabId } : { windowId };

    chrome.sidePanel.open(target)
      .then(() => {
        sendResponse({ status: "ok" });
      })
      .catch((err) => {
        // Fallback to windowId if tabId was rejected
        if (windowId && target.tabId) {
          chrome.sidePanel.open({ windowId })
            .then(() => sendResponse({ status: "ok" }))
            .catch((fallbackErr) => {
              console.error("Side panel failed to open:", fallbackErr);
              sendResponse({ status: "error", message: fallbackErr.message });
            });
        } else {
          console.error("Side panel failed to open:", err);
          sendResponse({ status: "error", message: err.message });
        }
      });

    return true; // Crucial: Keeps the message channel alive for async reply
  }
});