// Popup script for EsPass extension

const statusIndicator = document.getElementById('statusIndicator');
const statusText = document.getElementById('statusText');
const pairingIndicator = document.getElementById('pairingIndicator');
const pairingText = document.getElementById('pairingText');
const pairingSection = document.getElementById('pairingSection');
const pairingCodeInput = document.getElementById('pairingCodeInput');
const pairBtn = document.getElementById('pairBtn');
const pairingError = document.getElementById('pairingError');
const testConnectionBtn = document.getElementById('testConnection');
const fillCurrentPageBtn = document.getElementById('fillCurrentPage');

// Check connection and pairing status
function checkStatus() {
  chrome.runtime.sendMessage({ type: 'check-connection' }, (response) => {
    if (chrome.runtime.lastError) {
      console.log('Error checking connection:', chrome.runtime.lastError);
      updateStatus(false, false);
      return;
    }
    updateStatus(response?.connected || false, response?.paired || false);
  });
}

// Update UI status
function updateStatus(connected, paired) {
  // Connection status
  if (connected) {
    statusIndicator.classList.remove('disconnected');
    statusIndicator.classList.add('connected');
    statusText.textContent = 'Connected';
  } else {
    statusIndicator.classList.remove('connected');
    statusIndicator.classList.add('disconnected');
    statusText.textContent = 'Disconnected';
  }

  // Pairing status
  if (paired) {
    pairingIndicator.classList.remove('disconnected');
    pairingIndicator.classList.add('connected');
    pairingText.textContent = 'Paired';
    pairingSection.style.display = 'none';
    fillCurrentPageBtn.disabled = false;
  } else {
    pairingIndicator.classList.remove('connected');
    pairingIndicator.classList.add('disconnected');
    pairingText.textContent = 'Not Paired';
    if (connected) {
      pairingSection.style.display = 'block';
    }
    fillCurrentPageBtn.disabled = true;
  }
}

// Pairing button
pairBtn.addEventListener('click', () => {
  const code = pairingCodeInput.value.trim().toUpperCase();
  if (code.length !== 64) {
    pairingError.textContent = 'Please enter the 64-character App ID';
    pairingError.style.display = 'block';
    return;
  }

  pairingError.style.display = 'none';
  pairBtn.textContent = 'Pairing...';
  pairBtn.disabled = true;

  chrome.runtime.sendMessage({ type: 'pair', code: code }, (response) => {
    pairBtn.disabled = false;
    pairBtn.textContent = 'Pair';

    if (response && response.success) {
      pairingCodeInput.value = '';
      pairingError.textContent = '✅ Paired successfully! (Lifetime)';
      pairingError.style.color = '#4CAF50';
      pairingError.style.display = 'block';
      setTimeout(() => {
        checkStatus();
      }, 500);
    } else {
      pairingError.textContent = response?.error || 'Pairing failed. Check App ID.';
      pairingError.style.color = '#ffcccc';
      pairingError.style.display = 'block';
    }
  });
});

// Allow Enter key in pairing input
pairingCodeInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    pairBtn.click();
  }
});

// Test connection button
testConnectionBtn.addEventListener('click', () => {
  statusText.textContent = 'Reconnecting...';

  // Send reconnect request
  chrome.runtime.sendMessage({ type: 'reconnect' }, () => {
    setTimeout(() => {
      checkStatus();
    }, 1000);
  });
});

// Fill current page button
fillCurrentPageBtn.addEventListener('click', () => {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]) {
      fillCurrentPageBtn.textContent = '⏳ Requesting...';
      fillCurrentPageBtn.disabled = true;
      
      // Request credentials from background script (will auto-request from app if needed)
      chrome.runtime.sendMessage({ 
        type: 'request-credentials-for-url',
        url: tabs[0].url
      }, (response) => {
        if (response && response.success) {
          fillCurrentPageBtn.textContent = '✓ Requested!';
          setTimeout(() => {
            fillCurrentPageBtn.textContent = '🔑 Fill Current Page';
            fillCurrentPageBtn.disabled = false;
            checkStatus();
          }, 2000);
        } else {
          fillCurrentPageBtn.textContent = '✗ Failed';
          setTimeout(() => {
            fillCurrentPageBtn.textContent = '🔑 Fill Current Page';
            fillCurrentPageBtn.disabled = false;
          }, 2000);
        }
      });
    }
  });
});

// Check status on popup open
checkStatus();

// Update status every 2 seconds
setInterval(checkStatus, 2000);
