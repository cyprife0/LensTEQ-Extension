// LensTEQ - background.js
// Handles communication between extension components and the FastAPI backend server

// Flip this to switch where the extension sends scans:
//   true  -> your local server (python app.py on 127.0.0.1:8000)
//   false -> the deployed production backend on Render
const USE_LOCAL_BACKEND = true;

const BACKEND_URL = USE_LOCAL_BACKEND
  ? "http://127.0.0.1:8000"
  : "https://lensteq.onrender.com";

console.log(`[LensTEQ] Using backend: ${BACKEND_URL}`);

// --- Context menu: right-click a text selection to scan it ---
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "scanText",
    title: "📝 Scan Text with LensTEQ",
    contexts: ["selection"]
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "scanText" && info.selectionText) {
    fetch(`${BACKEND_URL}/analyze-text`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: info.selectionText }),
    })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP error! Status: ${res.status}`);
        return res.json();
      })
      .then((data) => {
        chrome.tabs.sendMessage(tab.id, {
          type: "SCAN_TEXT_RESULT",
          result: data,
        });
      })
      .catch((err) => {
        console.error("[LensTEQ] Text scan failed:", err);
        chrome.tabs.sendMessage(tab.id, {
          type: "SCAN_TEXT_RESULT",
          result: { verdict: "Error", final_score: 0 },
        });
      });
  }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {

  // 1. Handle scanning a video frame (base64 string)
  if (request.type === "SCAN_VIDEO_FRAME") {
    fetch(`${BACKEND_URL}/analyze-base64`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ image_data: request.frameData }),
    })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP error! Status: ${res.status}`);
        return res.json();
      })
      .then((data) => {
        if (sender.tab && sender.tab.id) {
          chrome.tabs.sendMessage(sender.tab.id, {
            type: "SCAN_VIDEO_RESULT",
            scanId: request.scanId,
            result: data,
          });
        }
      })
      .catch((err) => {
        console.error("[LensTEQ] Video frame scan failed:", err);
        if (sender.tab && sender.tab.id) {
          chrome.tabs.sendMessage(sender.tab.id, {
            type: "SCAN_VIDEO_RESULT",
            scanId: request.scanId,
            result: { verdict: "Error", final_score: 0 },
          });
        }
      });
    return true; // Keeps async message channel open
  }

  // 2. Handle scanning a single image by URL
  if (request.type === "SCAN_IMAGE") {
    fetch(`${BACKEND_URL}/analyze-url`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ url: request.imageUrl }),
    })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP error! Status: ${res.status}`);
        return res.json();
      })
      .then((data) => {
        if (sender.tab && sender.tab.id) {
          chrome.tabs.sendMessage(sender.tab.id, {
            type: "SCAN_RESULT",
            scanId: request.scanId,
            result: data,
          });
        }
      })
      .catch((err) => {
        console.error("[LensTEQ] Image scan failed:", err);
        if (sender.tab && sender.tab.id) {
          chrome.tabs.sendMessage(sender.tab.id, {
            type: "SCAN_RESULT",
            scanId: request.scanId,
            result: { verdict: "Error", final_score: 0 },
          });
        }
      });
    return true;
  }

  // 3. Handle scanning an audio element by URL
  if (request.type === "SCAN_AUDIO") {
    fetch(`${BACKEND_URL}/analyze-audio-url`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ url: request.audioUrl }),
    })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP error! Status: ${res.status}`);
        return res.json();
      })
      .then((data) => {
        if (sender.tab && sender.tab.id) {
          chrome.tabs.sendMessage(sender.tab.id, {
            type: "SCAN_AUDIO_RESULT",
            scanId: request.scanId,
            result: data,
          });
        }
      })
      .catch((err) => {
        console.error("[LensTEQ] Audio scan failed:", err);
        if (sender.tab && sender.tab.id) {
          chrome.tabs.sendMessage(sender.tab.id, {
            type: "SCAN_AUDIO_RESULT",
            scanId: request.scanId,
            result: { verdict: "Error", final_score: 0 },
          });
        }
      });
    return true;
  }

  // 4. Handle batch requests coming from popup.html ("Scan All Images")
  if (request.type === "BATCH_SCAN_IMAGES") {
    fetch(`${BACKEND_URL}/analyze-batch`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ urls: request.imageUrls }),
    })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP error! Status: ${res.status}`);
        return res.json();
      })
      .then((data) => {
        sendResponse({ success: true, results: data });
      })
      .catch((err) => {
        console.error("[LensTEQ] Batch scan failed:", err);
        sendResponse({ success: false, error: err.message });
      });
    return true;
  }
});