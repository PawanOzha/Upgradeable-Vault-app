# EsPass Browser Extension

Auto-fill extension for EsPass password manager.

## Installation

### Chrome / Brave / Edge

1. Open browser and navigate to:
   - **Chrome**: `chrome://extensions`
   - **Brave**: `brave://extensions`
   - **Edge**: `edge://extensions`

2. Enable **Developer mode** (toggle in top-right corner)

3. Click **Load unpacked**

4. Select the `Extention` folder from your EsPass installation

5. The extension should now appear in your browser toolbar

## How It Works

1. **WebSocket Connection**: The extension connects to your running EsPass app via WebSocket on port 9876

2. **Auto-Fill Detection**: When you open a website through EsPass (by clicking a site link), the extension:
   - Receives the URL and credentials from the app
   - Detects login form fields (username/email and password)
   - Automatically fills in your credentials
   - Shows a confirmation notification

3. **Security**: Credentials are only sent when you explicitly open a site through the EsPass app

## Features

- ✅ Auto-detects username/email fields
- ✅ Auto-detects password fields
- ✅ Visual feedback when fields are filled
- ✅ Works with most login forms
- ✅ Secure WebSocket communication
- ✅ Connection status indicator in popup

## Troubleshooting

**Extension shows "Disconnected"**
- Make sure EsPass app is running
- Check that port 9876 is not blocked by firewall

**Auto-fill not working**
- Open the site through EsPass app (don't manually navigate)
- Check browser console for errors (F12 → Console tab)
- Some sites may block auto-fill for security reasons

## Development

The extension consists of:
- `manifest.json` - Extension configuration
- `background.js` - WebSocket communication handler
- `content.js` - Page content script for form detection
- `popup.html/js` - Extension popup UI
