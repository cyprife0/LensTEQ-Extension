// Get last result
chrome.storage.local.get(['lastResult'], (data) => {
  if (data.lastResult) {
    showResult(data.lastResult);
  }
});

// Scan all images button
document.getElementById('scanAllBtn').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  
  chrome.tabs.sendMessage(tab.id, { type: 'SCAN_ALL' });
  
  document.getElementById('status').textContent = 'Scanning...';
});

// Listen for results
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'SCAN_RESULT') {
    showResult(request.result);
    chrome.storage.local.set({ lastResult: request.result });
  }
});

// Show result
function showResult(result) {
  document.getElementById('status').style.display = 'none';
  document.getElementById('result').style.display = 'block';
  
  const score = document.getElementById('score');
  const verdictEl = document.getElementById('verdict');

  // Backend failures must never be displayed as a real/fake score
  if (result.error || result.verdict === 'Error') {
    score.textContent = '--';
    score.style.color = '#d63031';
    verdictEl.textContent = '❌ Scan failed - try again';
    verdictEl.style.color = '#d63031';
    return;
  }

  score.textContent = result.final_score + '%';
  
  if (result.final_score >= 80) {
    score.style.color = '#d63031';
    document.getElementById('verdict').textContent = '🔴 HIGH RISK - AI Generated';
    document.getElementById('verdict').style.color = '#d63031';
  } else if (result.final_score >= 55) {
    score.style.color = '#fdcb6e';
    document.getElementById('verdict').textContent = '🟡 SUSPICIOUS';
    document.getElementById('verdict').style.color = '#fdcb6e';
  } else {
    score.style.color = '#00b894';
    document.getElementById('verdict').textContent = '🟢 LOW RISK - Likely Real';
    document.getElementById('verdict').style.color = '#00b894';
  }
}