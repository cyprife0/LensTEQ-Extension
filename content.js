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

// Sites like YouTube RECYCLE card elements: when you scroll or navigate,
// the same <ytd-rich-item-renderer> is reused for a different video. So a
// result must be keyed by the media itself (video ID or source URL), never
// by the element, or old results appear on new videos.
function getMediaKey(cardEl) {
  if (!cardEl) return null;

  // YouTube: use the video ID from the card's link (/watch?v=ID or /shorts/ID)
  const link = cardEl.matches('a[href]')
    ? cardEl
    : cardEl.querySelector('a[href*="/watch"], a[href*="/shorts/"]');
  if (link) {
    try {
      const u = new URL(link.href, location.href);
      const v = u.searchParams.get('v');
      if (v) return `yt:${v}`;
      const m = u.pathname.match(/\/shorts\/([\w-]+)/);
      if (m) return `yt:${m[1]}`;
    } catch (_) { /* fall through */ }
  }

  // Everything else: use the media source URL
  const media = cardEl.matches('video, audio, img')
    ? cardEl
    : cardEl.querySelector('video, audio, img');
  const src = media && (media.currentSrc || media.src || media.poster);
  if (src && src.length < 2000) {
    // blob: URLs are only unique within a page, so include the page URL
    return src.startsWith('blob:') ? `blob:${location.href}|${src}` : `src:${src}`;
  }

  // Last resort: the element itself
  return getOrCreateCardId(cardEl);
}

function clampRect(r, bound) {
  // Never let the overlay area extend beyond the card itself
  if (!bound || bound.width === 0 || bound.height === 0) return r;
  const left = Math.max(r.left, bound.left);
  const top = Math.max(r.top, bound.top);
  const right = Math.min(r.right, bound.right);
  const bottom = Math.min(r.bottom, bound.bottom);
  if (right <= left || bottom <= top) return bound;
  return { left, top, right, bottom, width: right - left, height: bottom - top };
}

function getCardBounds(cardEl) {
  if (!cardEl || !cardEl.isConnected) return null;

  const cardRect = cardEl.getBoundingClientRect();

  // Prefer the LARGEST visible media area inside the card (the thumbnail),
  // skipping small or not-yet-loaded images like avatars and lazy Shorts.
  const candidates = cardEl.matches('video, img, audio')
    ? [cardEl]
    : cardEl.querySelectorAll('#thumbnail, ytd-thumbnail, video, img');
  let best = null;
  for (const el of candidates) {
    const r = el.getBoundingClientRect();
    if (r.width >= 80 && r.height >= 60 &&
        (!best || r.width * r.height > best.width * best.height)) {
      best = r;
    }
  }
  if (best) return clampRect(best, cardRect);

  // Some elements (audio tags especially) collapse to zero size. Climb up
  // to the nearest ancestor with real dimensions, but still keep the
  // result inside the card's own box when the card has a size.
  let el = cardEl;
  for (let i = 0; i < 4 && el; i++) {
    const rect = el.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) return clampRect(rect, cardRect);
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

  const cardId = getMediaKey(hoveredCard);
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

const YT_CARD_SELECTOR =
  'ytd-reel-item-renderer, ytd-rich-item-renderer, ytd-grid-video-renderer, ' +
  'ytd-compact-video-renderer, ytd-video-renderer';
const CARD_SELECTOR = YT_CARD_SELECTOR + ', article, figure';

// A generic <article>/<figure> is only worth scanning if it actually holds
// real media. Sites like GitHub wrap text-only feed items in <article>,
// with nothing but tiny logos or avatars inside.
function isRealSizeMedia(el) {
  const r = el.getBoundingClientRect();
  if (el.tagName === 'AUDIO') return el.controls || (r.width > 0 && r.height > 0);
  return r.width >= 100 && r.height >= 60;
}

function hasScannableMedia(card) {
  if (card.matches(YT_CARD_SELECTOR)) return true; // thumbnails may still be loading
  return [...card.querySelectorAll('img, video, audio')].some(isRealSizeMedia);
}

function isFullScreenSized(el) {
  const r = el.getBoundingClientRect();
  return r.width >= window.innerWidth * 0.85 && r.height >= window.innerHeight * 0.85;
}

function findCardElement(target, x, y) {
  if (!target || target === document.body || target === document.documentElement) return null;

  const card = target.closest(CARD_SELECTOR);

  if (card && !isFullScreenSized(card) && hasScannableMedia(card)) {
    return card;
  }

  // YouTube's hover preview plays in a separate player that sits ON TOP of
  // the card but is not inside it. Look underneath the cursor for the real
  // card, so the scan result is saved under the card's video ID and shows
  // again when you hover back.
  if (typeof x === 'number' && typeof y === 'number' && document.elementsFromPoint) {
    const under = deepElementsFromPoint(x, y).find(
      (el) => el.matches && el.matches(CARD_SELECTOR)
    );
    if (under && !isFullScreenSized(under) && hasScannableMedia(under)) return under;
  }

  const video = target.closest('video');
  if (video && isRealSizeMedia(video)) return video;

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

// YouTube is a single-page app: on navigation, hide everything so nothing
// from the previous page lingers.
document.addEventListener('yt-navigate-finish', () => {
  hoveredCard = null;
  updateOverlays();
});

// Cards can change content while the mouse sits still (recycled elements,
// autoplay previews). Re-check the hovered card a few times a second.
setInterval(() => {
  if (hoveredCard) updateOverlays();
}, 400);

scanBtn.onclick = (ev) => {
  ev.preventDefault();
  ev.stopPropagation();
  if (hoveredCard) {
    const cardId = getMediaKey(hoveredCard);
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

  if (result.error || result.verdict === 'Error') {
    text = '❌ API Error';
    color = '#d63031';
  } else if (rawScore >= 80) {
    text = `🔴 FAKE (${formattedScore}%)`;
    color = '#d63031';
  } else if (rawScore >= 55) {
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
  if (result.error || result.verdict === 'Error') {
    text = '❌ API Error';
    color = '#d63031';
  } else if (rawScore >= 80) {
    text = `🔴 AI-WRITTEN (${formattedScore}%)`;
    color = '#d63031';
  } else if (rawScore >= 55) {
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