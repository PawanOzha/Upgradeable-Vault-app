// Content script for EsPass extension
// Runs on web pages to detect and auto-fill login forms

console.log('[EsPass Content] Script loaded on:', window.location.href);

// Function to find username/email input fields
function findUsernameField() {
  const selectors = [
    'input[type="email"]',
    'input[type="text"][name*="user" i]',
    'input[type="text"][name*="email" i]',
    'input[type="text"][name*="login" i]',
    'input[type="text"][id*="user" i]',
    'input[type="text"][id*="email" i]',
    'input[type="text"][id*="login" i]',
    'input[type="text"][placeholder*="user" i]',
    'input[type="text"][placeholder*="email" i]',
    'input[type="text"][autocomplete="username"]',
    'input[type="text"][autocomplete="email"]',
    'input[name="username"]',
    'input[name="email"]',
    'input[id="username"]',
    'input[id="email"]'
  ];

  for (const selector of selectors) {
    const field = document.querySelector(selector);
    if (field && isVisible(field)) {
      return field;
    }
  }

  // Fallback: find first visible text input
  const textInputs = document.querySelectorAll('input[type="text"]');
  for (const input of textInputs) {
    if (isVisible(input)) {
      return input;
    }
  }

  return null;
}

// Function to find password input fields
function findPasswordField() {
  const passwordInputs = document.querySelectorAll('input[type="password"]');
  for (const input of passwordInputs) {
    if (isVisible(input)) {
      return input;
    }
  }
  return null;
}

// Check if element is visible
function isVisible(element) {
  if (!element) return false;
  const style = window.getComputedStyle(element);
  return style.display !== 'none' &&
         style.visibility !== 'hidden' &&
         style.opacity !== '0' &&
         element.offsetParent !== null;
}

// Fill input field with animation
function fillField(field, value) {
  if (!field || !value) return false;

  try {
    // Focus the field
    field.focus();

    // Set the value
    field.value = value;

    // Trigger various events that websites might listen to
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new Event('change', { bubbles: true }));
    field.dispatchEvent(new Event('blur', { bubbles: true }));

    // Add visual feedback
    const originalBorder = field.style.border;
    field.style.border = '2px solid #4CAF50';
    setTimeout(() => {
      field.style.border = originalBorder;
    }, 1000);

    return true;
  } catch (error) {
    console.error('[EsPass Content] Error filling field:', error);
    return false;
  }
}

// Function to find login/signup button
function findLoginButton() {
  // Common button selectors for login/signup
  const buttonSelectors = [
    'button[type="submit"]',
    'input[type="submit"]',
    'button[name*="login" i]',
    'button[id*="login" i]',
    'button[name*="signin" i]',
    'button[id*="signin" i]',
    'button[name*="submit" i]',
    'button[id*="submit" i]',
    'input[value*="login" i]',
    'input[value*="sign in" i]',
    'input[value*="log in" i]'
  ];

  // Try specific selectors first
  for (const selector of buttonSelectors) {
    const buttons = document.querySelectorAll(selector);
    for (const button of buttons) {
      if (isVisible(button)) {
        return button;
      }
    }
  }

  // Try finding by button text content
  const allButtons = document.querySelectorAll('button');
  const loginKeywords = /log\s*in|sign\s*in|submit|continue|next|enter/i;
  
  for (const button of allButtons) {
    const text = button.textContent.trim().toLowerCase();
    if (loginKeywords.test(text) && isVisible(button)) {
      return button;
    }
  }

  // Fallback: find form submit button
  const passwordField = findPasswordField();
  if (passwordField) {
    const form = passwordField.closest('form');
    if (form) {
      const submitBtn = form.querySelector('button[type="submit"], input[type="submit"]');
      if (submitBtn && isVisible(submitBtn)) {
        return submitBtn;
      }
    }
  }

  return null;
}

// Main auto-fill function with optional auto-click
function autoFillCredentials(credentials, autoClick = false) {
  console.log('[EsPass Content] Attempting auto-fill... Auto-click:', autoClick);

  try {
    const maxAttempts = 10;
    let attempts = 0;

    const tryFill = () => {
      const usernameField = findUsernameField();
      const passwordField = findPasswordField();

      if (!usernameField && !passwordField) {
        attempts++;
        if (attempts < maxAttempts) {
          setTimeout(tryFill, 500);
          return;
        }

        console.log('[EsPass Content] No login fields found');
        chrome.runtime.sendMessage({
          type: 'autofill-failed',
          error: 'No login fields found'
        });
        return;
      }

      let filledCount = 0;

      if (usernameField && credentials.username) {
        if (fillField(usernameField, credentials.username)) {
          console.log('[EsPass Content] Username filled');
          filledCount++;
        }
      }

      if (passwordField && credentials.password) {
        if (fillField(passwordField, credentials.password)) {
          console.log('[EsPass Content] Password filled');
          filledCount++;
        }
      }

      if (filledCount > 0) {
        console.log(`[EsPass Content] Successfully filled ${filledCount} field(s)`);
        chrome.runtime.sendMessage({ type: 'autofill-success' });
        showNotification(`Auto-filled ${filledCount} field(s)`);

        // Auto-click login button if flag is set (opened from app)
        if (autoClick) {
          setTimeout(() => {
            const loginButton = findLoginButton();
            if (loginButton) {
              console.log('[EsPass Content] Auto-clicking login button');
              loginButton.click();
              showNotification('Login button clicked');
            } else {
              console.log('[EsPass Content] Login button not found for auto-click');
            }
          }, 800); // Wait a bit after filling to ensure fields are processed
        }
      } else {
        chrome.runtime.sendMessage({
          type: 'autofill-failed',
          error: 'Failed to fill fields'
        });
      }
    };

    // Initial attempt; retries if needed
    setTimeout(tryFill, 300);
  } catch (error) {
    console.error('[EsPass Content] Auto-fill error:', error);
    chrome.runtime.sendMessage({
      type: 'autofill-failed',
      error: error.message
    });
  }
}

// Show notification on page
function showNotification(message) {
  const notification = document.createElement('div');
  notification.textContent = `🔐 EsPass: ${message}`;
  notification.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    background: #4CAF50;
    color: white;
    padding: 15px 20px;
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.2);
    z-index: 999999;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 14px;
    font-weight: 500;
    animation: slideIn 0.3s ease-out;
  `;

  document.body.appendChild(notification);

  setTimeout(() => {
    notification.style.opacity = '0';
    notification.style.transition = 'opacity 0.3s ease-out';
    setTimeout(() => notification.remove(), 300);
  }, 3000);
}

// Listen for messages from background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'autofill' && message.credentials) {
    console.log('[EsPass Content] Received auto-fill request');
    // Pass autoClick flag if present (true when opened from app, false/undefined otherwise)
    autoFillCredentials(message.credentials, message.autoClick || false);
    sendResponse({ success: true });
    return false; // Synchronous response
  }
  
  // Always send a response to avoid channel closed error
  sendResponse({ success: false, error: 'Unknown message type' });
  return false; // Synchronous response
});

// On page load, check if we have pending credentials
window.addEventListener('load', () => {
  console.log('[EsPass Content] Page fully loaded');

  // Ask background script for credentials
  chrome.runtime.sendMessage({
    type: 'get-credentials',
    url: window.location.href
  }, (response) => {
    if (response && response.credentials) {
      console.log('[EsPass Content] Found pending credentials');
      // Manual navigation - autofill but don't auto-click (autoClick = false)
      autoFillCredentials(response.credentials, response.autoClick || false);
    }
  });
});
