// Background service worker for EsPass extension
// Handles WebSocket communication with the Electron app

let ws = null;
let wsPort = 9876; // WebSocket port
let pendingCredentials = null;
let reconnectInterval = null;
let isConnected = false;
let isPaired = false;
let appId = null; // Permanent app ID (never changes)
let sessionKey = null; // Session key for encrypted communication
let credentialRequestCallbacks = new Map(); // Track pending credential requests

// Decrypt data from transport encryption (XOR with session key)
function decryptFromTransport(encryptedData, key) {
  try {
    // Decode base64 to bytes
    const encryptedBytes = atob(encryptedData);
    const keyBytes = [];

    // Convert hex key to bytes
    for (let i = 0; i < key.length; i += 2) {
      keyBytes.push(parseInt(key.substr(i, 2), 16));
    }

    // XOR decrypt
    let decrypted = '';
    for (let i = 0; i < encryptedBytes.length; i++) {
      decrypted += String.fromCharCode(encryptedBytes.charCodeAt(i) ^ keyBytes[i % keyBytes.length]);
    }

    return decrypted;
  } catch (error) {
    console.error('[EsPass] Decryption error:', error);
    return encryptedData; // Return original if decryption fails
  }
}

// Safely extract hostname from URLs (tolerates missing protocol)
function getHostname(u) {
  try {
    return new URL(u).hostname;
  } catch (_) {
    try {
      return new URL('https://' + u).hostname;
    } catch (__) {
      // Last resort: simple hostname heuristic
      const match = String(u).match(/([a-z0-9.-]+\.[a-z]{2,})(?:[:/]|$)/i);
      return match ? match[1] : '';
    }
  }
}

// Connect to WebSocket server in Electron app
function connectWebSocket() {
  // Don't try to connect if already connected
  if (ws && ws.readyState === WebSocket.OPEN) {
    console.log('[EsPass] Already connected');
    return;
  }

  // Don't try to connect if connection is in progress
  if (ws && ws.readyState === WebSocket.CONNECTING) {
    console.log('[EsPass] Connection already in progress');
    return;
  }

  try {
    console.log('[EsPass] Attempting to connect to ws://localhost:' + wsPort);
    ws = new WebSocket('ws://localhost:' + wsPort);

    ws.onopen = async () => {
      console.log('[EsPass] ✅ Connected to EsPass app successfully!');
      isConnected = true;

      // Clear reconnect interval if connection is successful
      if (reconnectInterval) {
        clearInterval(reconnectInterval);
        reconnectInterval = null;
      }

      // Try to pair with stored app ID
      try {
        const stored = await chrome.storage.local.get(['appId']);
        if (stored.appId) {
          appId = stored.appId;
          
          // MIGRATION: Clear old 12-char App IDs (upgraded to 64-char)
          if (appId.length === 12) {
            console.log('[EsPass] ⚠️ Old 12-character App ID detected. Please re-pair with new 64-character ID.');
            chrome.storage.local.remove(['appId']);
            appId = null;
            isPaired = false;
            return;
          }
          
          console.log('[EsPass] Attempting to pair with stored app ID...');
          ws.send(JSON.stringify({ type: 'pair', code: appId }));
        } else {
          console.log('[EsPass] No app ID stored. Please pair in popup.');
          isPaired = false;
        }
      } catch (error) {
        console.error('[EsPass] Error loading app ID:', error);
      }
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        console.log('[EsPass] 📨 Received message:', data.type);

        // Handle pairing success
        if (data.type === 'pair-success') {
          isPaired = true;
          // Store session key for encrypted communication
          if (data.sessionKey) {
            sessionKey = data.sessionKey;
            console.log('[EsPass] ✅ Paired successfully with encrypted session!');
          } else {
            console.log('[EsPass] ✅ Paired successfully! This pairing is permanent.');
          }
          return;
        }

        // Handle pairing failure
        if (data.type === 'pair-failed') {
          isPaired = false;
          console.log('[EsPass] ❌ Pairing failed:', data.message);
          chrome.storage.local.remove(['appId']);
          appId = null;
          return;
        }

        // Handle credential response
        if (data.type === 'credentials-response') {
          if (data.success) {
            console.log('[EsPass] 🔑 Credentials received for:', data.url);

            // Decrypt credentials if encrypted
            let username = data.username;
            let password = data.password;

            if (data.encrypted && sessionKey) {
              console.log('[EsPass] 🔓 Decrypting credentials...');
              username = decryptFromTransport(data.username, sessionKey);
              password = decryptFromTransport(data.password, sessionKey);
            }

            // Store credentials temporarily
            pendingCredentials = {
              url: data.url,
              username: username,
              password: password,
              timestamp: Date.now()
            };

            // Send to all matching tabs
            const targetHost = getHostname(data.url);
            chrome.tabs.query({}, (tabs) => {
              tabs.forEach((tab) => {
                try {
                  const tabHost = tab.url ? getHostname(tab.url) : '';
                  if (tabHost && targetHost && tabHost.endsWith(targetHost)) {
                    console.log('[EsPass] Sending credentials to tab:', tab.id);
                    chrome.tabs.sendMessage(tab.id, {
                      type: 'autofill',
                      credentials: pendingCredentials,
                      autoClick: data.autoClick || false  // Pass auto-click flag from app
                    }).catch(err => console.log('[EsPass] Tab not ready:', err));
                  }
                } catch (err) {
                  console.log('[EsPass] Skipped tab host check:', err);
                }
              });
            });
          } else {
            console.log('[EsPass] ⚠️ Credential request failed:', data.error);
          }
          return;
        }

        // Legacy: push-based credentials (backward compatibility)
        if (data.type === 'credentials') {
          // Decrypt credentials if encrypted
          let username = data.username;
          let password = data.password;

          if (data.encrypted && sessionKey) {
            console.log('[EsPass] 🔓 Decrypting credentials (push)...');
            username = decryptFromTransport(data.username, sessionKey);
            password = decryptFromTransport(data.password, sessionKey);
          }

          pendingCredentials = {
            url: data.url,
            username: username,
            password: password,
            autoClick: data.autoClick || false,  // Store auto-click flag
            timestamp: Date.now()
          };

          console.log('[EsPass] 🔑 Credentials received (push):', data.url, 'Auto-click:', data.autoClick);

          const targetHost = getHostname(data.url);
          chrome.tabs.query({}, (tabs) => {
            tabs.forEach((tab) => {
              try {
                const tabHost = tab.url ? getHostname(tab.url) : '';
                if (tabHost && targetHost && tabHost.endsWith(targetHost)) {
                  console.log('[EsPass] Sending credentials to tab:', tab.id);
                  chrome.tabs.sendMessage(tab.id, {
                    type: 'autofill',
                    credentials: pendingCredentials,
                    autoClick: data.autoClick || false  // Pass auto-click flag from app
                  }).catch(err => console.log('[EsPass] Tab not ready:', err));
                }
              } catch (err) {
                console.log('[EsPass] Skipped tab host check:', err);
              }
            });
          });
        }
      } catch (error) {
        console.error('[EsPass] Error processing message:', error);
      }
    };

    ws.onerror = (error) => {
      console.error('[EsPass] ❌ WebSocket error:', error);
      console.error('[EsPass] Make sure your EsPass app is running!');
      isConnected = false;
    };

    ws.onclose = (event) => {
      console.log('[EsPass] 🔌 WebSocket connection closed');
      console.log('[EsPass] Code:', event.code, 'Reason:', event.reason || 'No reason provided');
      isConnected = false;
      ws = null;

      // Try to reconnect every 3 seconds
      if (!reconnectInterval) {
        console.log('[EsPass] Will attempt to reconnect every 3 seconds...');
        reconnectInterval = setInterval(() => {
          console.log('[EsPass] Reconnecting...');
          connectWebSocket();
        }, 3000);
      }
    };
  } catch (error) {
    console.error('[EsPass] Failed to create WebSocket:', error);
    isConnected = false;
  }
}

// Listen for tab updates to handle page navigation
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url) {
    console.log('[EsPass] Page loaded:', tab.url);

    // If we have pending credentials for this URL, send them
    try {
      const targetHost = pendingCredentials ? getHostname(pendingCredentials.url) : '';
      const tabHost = tab.url ? getHostname(tab.url) : '';
      if (pendingCredentials && tabHost && targetHost && tabHost.endsWith(targetHost)) {
        chrome.tabs.sendMessage(tabId, {
          type: 'autofill',
          credentials: pendingCredentials,
          autoClick: pendingCredentials.autoClick || false  // Pass auto-click flag
        }).catch(err => {
          console.log('[EsPass] Tab not ready for auto-fill:', err.message);
        });
      }
    } catch (error) {
      console.error('[EsPass] Error checking URL for auto-fill:', error);
    }
  }
});

// Request credentials for a URL
function requestCredentials(url) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    console.log('[EsPass] Cannot request credentials: not connected');
    return false;
  }

  if (!isPaired) {
    console.log('[EsPass] Cannot request credentials: not paired');
    return false;
  }

  try {
    ws.send(JSON.stringify({ 
      type: 'request-credentials',
      url: url
    }));
    console.log('[EsPass] Requested credentials for:', url);
    return true;
  } catch (error) {
    console.error('[EsPass] Error requesting credentials:', error);
    return false;
  }
}

// Listen for messages from content scripts and popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'pair') {
    // Store app ID permanently and attempt to pair
    chrome.storage.local.set({ appId: message.code }, () => {
      appId = message.code;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'pair', code: appId }));
        console.log('[EsPass] Pairing attempt with app ID:', appId);
        sendResponse({ success: true, message: 'Pairing initiated (lifetime)' });
      } else {
        sendResponse({ success: false, error: 'Not connected to app' });
      }
    });
    return false;
  } else if (message.type === 'check-pairing') {
    sendResponse({ paired: isPaired, connected: isConnected });
    return false;
  } else if (message.type === 'request-credentials-for-url') {
    // Request credentials from app for specific URL
    const success = requestCredentials(message.url);
    sendResponse({ success: success });
    return false;
  } else if (message.type === 'get-credentials') {
    // Check if we have pending credentials for this URL
    try {
      const targetHost = pendingCredentials ? getHostname(pendingCredentials.url) : '';
      const pageHost = message.url ? getHostname(message.url) : '';
      if (pendingCredentials && pageHost && targetHost && pageHost.endsWith(targetHost)) {
        // Manual navigation - return credentials but DON'T auto-click (autoClick stays false)
        sendResponse({ 
          credentials: pendingCredentials, 
          autoClick: false  // Never auto-click for manual navigation
        });
      } else {
        // Try to request from app if paired
        if (isPaired) {
          requestCredentials(message.url);
        }
        sendResponse({ credentials: null });
      }
    } catch (error) {
      console.error('[EsPass] Error checking credentials:', error);
      sendResponse({ credentials: null });
    }
    return false; // Synchronous response
  } else if (message.type === 'autofill-success') {
    console.log('[EsPass] Auto-fill successful');
    // Clear pending credentials after successful fill
    pendingCredentials = null;
    sendResponse({ success: true });
    return false; // Synchronous response
  } else if (message.type === 'autofill-failed') {
    console.log('[EsPass] Auto-fill failed:', message.error);
    sendResponse({ success: false });
    return false; // Synchronous response
  } else if (message.type === 'check-connection') {
    // Popup checking if we're connected
    sendResponse({ connected: isConnected, paired: isPaired });
    return false; // Synchronous response
  } else if (message.type === 'reconnect') {
    // Popup requesting reconnect
    console.log('[EsPass] Reconnect requested from popup');
    connectWebSocket();
    sendResponse({ status: 'reconnecting' });
    return false; // Synchronous response
  }
  
  // Always send a response to avoid channel closed error
  sendResponse({ success: false, error: 'Unknown message type' });
  return false; // Synchronous response
});

// Clean up old pending credentials (expire after 30 seconds)
setInterval(() => {
  if (pendingCredentials && Date.now() - pendingCredentials.timestamp > 30000) {
    console.log('[EsPass] Credentials expired');
    pendingCredentials = null;
  }
}, 5000);

// Initialize WebSocket connection
connectWebSocket();

console.log('[EsPass] Background service worker initialized');
