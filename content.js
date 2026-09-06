// LensTEQ - content.js
const scanResults = new Map();
const scanningMedia = new Set();

let hoveredCard = null;
let hideTimeout = null;
let cardIdCounter = 0;

const scanBtn = document.createElement('button');
scanBtn.className = 'lensteq-scan-btn';

const badge = document.createElement('div');
badge.className = 'lensteq-badge';

function appendOverlays() {
  if (document.body && !document.body.contains(scanBtn)) {
    document.body.appendChild(scanBtn);
    document.body.appendChild(badge);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', appendOverlays);
} else {
  appendOverlays();
}

function getOrCreateCardId(cardEl) {
  if (!cardEl) return null;
  if (!cardEl.dataset.lensteqId) {
    cardIdCounter++;
    cardEl.dataset.lensteqId = `lensteq_card_${Date.now()}_${cardIdCounter}`;
  }
  return cardEl.dataset.lensteqId;
}

function getCardBounds(cardEl) {
  if (!cardEl || !cardEl.isConnected) return null;

  const targetEl =
    cardEl.querySelector('#thumbnail, ytd-thumbnail, video, img, audio') || cardEl;

  // Some elements (audio tags especially, and swapped video/img thumbnails)
  // can collapse to zero size. Climb up to the nearest ancestor that still
  // has real dimensions instead of returning a degenerate rect.
  let el = targetEl;
  for (let i = 0; i < 4 && el; i++) {
    const rect = el.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) return rect;
    el = el.parentElement;
  }
  return null;
}

function positionElement(el, rect, offsetTop, offsetSide) {
  el.style.top = `${rect.top + offsetTop}px`;

  if (offsetSide === 'left') {
    el.style.left = `${rect.left + 4}px`;
    el.style.right = 'auto';
  } else {
    const rightOffset = window.innerWidth - rect.right + 4;
    el.style.right = `${Math.max(0, rightOffset)}px`;
    el.style.left = 'auto';
  }
}

function updateOverlays() {
  if (!hoveredCard || !hoveredCard.isConnected) {
    scanBtn.style.display = 'none';
    badge.style.display = 'none';
    return;
  }

  const rect = getCardBounds(hoveredCard);
  if (!rect) {
    scanBtn.style.display = 'none';
    badge.style.display = 'none';
    return;
  }

  const cardId = getOrCreateCardId(hoveredCard);
  const storedResult = scanResults.get(cardId);
  const isCurrentlyScanning = scanningMedia.has(cardId);
  const hasVideo =
    hoveredCard.querySelector('video') ||
    hoveredCard.tagName.toLowerCase() === 'video';
  const hasAudio =
    hoveredCard.querySelector('audio') ||
    hoveredCard.tagName.toLowerCase() === 'audio';

  positionElement(scanBtn, rect, 4, 'right');
  scanBtn.style.display = 'block';

  if (isCurrentlyScanning) {
    scanBtn.textContent = '🔍 Scanning...';
    scanBtn.style.opacity = '0.7';
    scanBtn.style.cursor = 'wait';
    badge.style.display = 'none';
  } else {
    scanBtn.style.opacity = '1';
    scanBtn.style.cursor = 'pointer';

    if (storedResult) {
      badge.textContent = storedResult.text;
      badge.style.background = storedResult.color;
      positionElement(badge, rect, 4, 'left');
      badge.style.display = 'block';
      scanBtn.textContent = hasAudio ? '🎙️ Rescan' : '🎬 Rescan';
    } else {
      badge.style.display = 'none';
      scanBtn.textContent = hasAudio ? '🎙️ Scan' : (hasVideo ? '🎬 Scan' : '🔍 Scan');
    }
  }
}

function scheduleHide() {
  clearTimeout(hideTimeout);
  hideTimeout = setTimeout(() => {
    hoveredCard = null;
    updateOverlays();
  }, 100);
}

function deepElementsFromPoint(x, y) {
  // document.elementsFromPoint() does not see inside shadow roots by
  // default — it only returns the shadow host element. Google's own
  // products (Meet, YouTube) render heavily with Shadow DOM, which is
  // likely why plain elementsFromPoint found nothing on Meet. Recursively
  // descend into any shadow roots at this point to find what's really there.
  let results = document.elementsFromPoint(x, y);
  const all = [...results];

  let current = results;
  for (let depth = 0; depth < 6 && current.length > 0; depth++) {
    const host = current.find((el) => el.shadowRoot);
    if (!host || !host.shadowRoot.elementsFromPoint) break;

    const nested = host.shadowRoot.elementsFromPoint(x, y);
    if (nested.length === 0) break;

    all.push(...nested);
    current = nested;
  }

  return all;
}

function findCardElement(target, x, y) {
  if (!target || target === document.body || target === document.documentElement) return null;

  const card = target.closest(
    'ytd-reel-item-renderer, ytd-rich-item-renderer, ytd-grid-video-renderer, ytd-compact-video-renderer, ytd-video-renderer, article, figure'
  );

  if (card) {
    const r = card.getBoundingClientRect();
    if (r.width >= window.innerWidth * 0.85 && r.height >= window.innerHeight * 0.85) {
      return null;
    }
    return card;
  }

  const video = target.closest('video');
  if (video) return video;

  const audio = target.closest('audio');
  if (audio) return audio;

  const img = target.closest('img');
  if (img && img.width >= 100 && img.height >= 100) return img;

  // Fallback for video-call UIs (Google Meet, Zoom web client, etc.): these
  // sites render mute icons, name labels, and click-handling overlays as
  // separate elements stacked ON TOP OF the actual <video> tag, and often
  // wrap everything in Shadow DOM (same pattern as YouTube's ytd-* custom
  // elements). target.closest('video') fails because the overlay isn't a
  // descendant of the video, and plain elementsFromPoint can't see past
  // shadow boundaries. Pierce through both problems at once.
  if (typeof x === 'number' && typeof y === 'number' && document.elementsFromPoint) {
    const stack = deepElementsFromPoint(x, y);
    const stackedVideo = stack.find((el) => el.tagName === 'VIDEO');
    if (stackedVideo) return stackedVideo;
    const stackedAudio = stack.find((el) => el.tagName === 'AUDIO');
    if (stackedAudio) return stackedAudio;
  }

  return null;
}

document.addEventListener('mouseover', (e) => {
  const card = findCardElement(e.target, e.clientX, e.clientY);
  if (!card) return;

  clearTimeout(hideTimeout);
  hoveredCard = card;
  updateOverlays();
}, true);

document.addEventListener('mouseout', (e) => {
  const card = findCardElement(e.target, e.clientX, e.clientY);
  if (!card || card === hoveredCard) {
    scheduleHide();
  }
}, true);

window.addEventListener('scroll', () => {
  if (hoveredCard) updateOverlays();
}, { passive: true });

window.addEventListener('resize', () => {
  if (hoveredCard) updateOverlays();
}, { passive: true });

scanBtn.onclick = (ev) => {
  ev.preventDefault();
  ev.stopPropagation();
  if (hoveredCard) {
    const cardId = getOrCreateCardId(hoveredCard);
    if (!scanningMedia.has(cardId)) {
      scanMedia(hoveredCard, cardId);
    }
  }
};

[scanBtn, badge].forEach((el) => {
  el.addEventListener('mouseenter', () => clearTimeout(hideTimeout));
  el.addEventListener('mouseleave', scheduleHide);
});

const pendingScans = new Map();

function generateId() {
  return Math.random().toString(36).substring(2, 15);
}

async function scanMedia(cardEl, cardId) {
  scanningMedia.add(cardId);
  updateOverlays();

  return new Promise((resolve) => {
    const scanId = generateId();
    pendingScans.set(scanId, { cardId, resolve });

    try {
      const video =
        cardEl.querySelector('video') ||
        (cardEl.tagName.toLowerCase() === 'video' ? cardEl : null);
      const audio =
        cardEl.querySelector('audio') ||
        (cardEl.tagName.toLowerCase() === 'audio' ? cardEl : null);
      const img =
        cardEl.querySelector('img') ||
        (cardEl.tagName.toLowerCase() === 'img' ? cardEl : null);

      if (video) {
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth || 640;
        canvas.height = video.videoHeight || 480;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

        const frameData = canvas.toDataURL('image/jpeg', 0.7);

        chrome.runtime.sendMessage({
          type: 'SCAN_VIDEO_FRAME',
          frameData: frameData,
          scanId: scanId,
        });
      } else if (audio) {
        // Audio can't be captured as a canvas frame — send the source URL
        // and let the backend fetch + analyze the actual file.
        const audioUrl = audio.currentSrc || audio.src;
        if (!audioUrl) throw new Error('No audio source found');

        chrome.runtime.sendMessage({
          type: 'SCAN_AUDIO',
          audioUrl: audioUrl,
          scanId: scanId,
        });
      } else if (img) {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth || img.width || 400;
        canvas.height = img.naturalHeight || img.height || 400;
        const ctx = canvas.getContext('2d');

        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const imageData = canvas.toDataURL('image/jpeg', 0.7);

        chrome.runtime.sendMessage({
          type: 'SCAN_VIDEO_FRAME',
          frameData: imageData,
          scanId: scanId,
        });
      } else {
        throw new Error('No valid media found inside container');
      }
    } catch (error) {
      console.warn('LensTEQ extraction fallback to direct URL due to:', error);
      const img = cardEl.querySelector('img') || (cardEl.tagName.toLowerCase() === 'img' ? cardEl : null);
      if (img && img.src) {
        chrome.runtime.sendMessage({
          type: 'SCAN_IMAGE',
          imageUrl: img.src,
          scanId: scanId,
        });
      } else {
        applyResult(cardId, { verdict: 'Error', final_score: 0 });
        pendingScans.delete(scanId);
        resolve();
      }
    }
  });
}

function applyResult(cardId, result) {
  scanningMedia.delete(cardId);

  const rawScore = Number(result.final_score || 0);
  const formattedScore = rawScore % 1 === 0 ? rawScore : rawScore.toFixed(1);

  let text, color;

  if (result.verdict === 'Error') {
    text = '❌ API Error';
    color = '#d63031';
  } else if (rawScore > 70) {
    text = `🔴 FAKE (${formattedScore}%)`;
    color = '#d63031';
  } else if (rawScore > 50) {
    text = `🟡 SUSPICIOUS (${formattedScore}%)`;
    color = '#fdcb6e';
  } else {
    text = `🟢 REAL (${formattedScore}%)`;
    color = '#00b894';
  }

  scanResults.set(cardId, { text, color });
  updateOverlays();
}

// --- Text selection scanning (right-click context menu) ---
// Cache the selection's bounding rect the moment the context menu opens,
// since by the time the async scan result comes back the live selection
// may have been cleared by the user clicking elsewhere.
let lastSelectionRect = null;

document.addEventListener('contextmenu', () => {
  const selection = window.getSelection();
  if (selection && selection.rangeCount > 0 && !selection.isCollapsed) {
    lastSelectionRect = selection.getRangeAt(0).getBoundingClientRect();
  }
}, true);

function showTextResultBadge(result) {
  const rawScore = Number(result.final_score || 0);
  const formattedScore = rawScore % 1 === 0 ? rawScore : rawScore.toFixed(1);

  let text, color;
  if (result.verdict === 'Error') {
    text = '❌ API Error';
    color = '#d63031';
  } else if (rawScore > 70) {
    text = `🔴 AI-WRITTEN (${formattedScore}%)`;
    color = '#d63031';
  } else if (rawScore > 50) {
    text = `🟡 SUSPICIOUS (${formattedScore}%)`;
    color = '#fdcb6e';
  } else {
    text = `🟢 LIKELY HUMAN (${formattedScore}%)`;
    color = '#00b894';
  }

  const rect = lastSelectionRect || { top: 20, left: 20, right: 20, bottom: 20 };

  badge.textContent = text;
  badge.style.background = color;
  positionElement(badge, rect, -32, 'left');
  badge.style.display = 'block';
  scanBtn.style.display = 'none';

  clearTimeout(hideTimeout);
  hideTimeout = setTimeout(() => {
    badge.style.display = 'none';
  }, 4000);
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (
    (request.type === 'SCAN_RESULT' ||
      request.type === 'SCAN_VIDEO_RESULT' ||
      request.type === 'SCAN_AUDIO_RESULT') &&
    request.scanId
  ) {
    const pending = pendingScans.get(request.scanId);
    if (pending) {
      applyResult(pending.cardId, request.result);
      pending.resolve();
      pendingScans.delete(request.scanId);
    }
  }

  if (request.type === 'SCAN_TEXT_RESULT') {
    showTextResultBadge(request.result);
  }
});