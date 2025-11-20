# EsPass Extension Installation Guide

## Step 1: Create Icons (Temporary Workaround)

Before loading the extension, you need to create icon files:

1. Open `Extention/icons/create-icons.html` in your browser
2. Three icon files will be automatically downloaded:
   - icon16.png
   - icon48.png
   - icon128.png
3. Move these downloaded files to the `Extention/icons/` folder

## Step 2: Install Extension in Browser

### For Chrome:
1. Open Chrome
2. Go to `chrome://extensions`
3. Enable **Developer mode** (toggle in top-right)
4. Click **Load unpacked**
5. Select the `Extention` folder
6. Extension will appear with a lock icon

### For Brave:
1. Open Brave
2. Go to `brave://extensions`
3. Enable **Developer mode** (toggle in top-right)
4. Click **Load unpacked**
5. Select the `Extention` folder
6. Extension will appear with a lock icon

### For Edge:
1. Open Edge
2. Go to `edge://extensions`
3. Enable **Developer mode** (toggle in bottom-left)
4. Click **Load unpacked**
5. Select the `Extention` folder
6. Extension will appear with a lock icon

## Step 3: Test the Extension

1. Make sure your EsPass app is running
2. Click the extension icon in your browser toolbar
3. Check if it shows "Connected" status
4. If disconnected, click "Test Connection"

## Step 4: Use Auto-Fill

1. In EsPass app, add a credential with:
   - Title: Any name
   - Site Link: Full URL (e.g., https://example.com/login)
   - Username: Your username
   - Password: Your password

2. Click the site link in EsPass app

3. Choose your browser (Chrome/Brave/Edge)

4. The browser will open with the site

5. The extension will automatically fill your credentials!

## Troubleshooting

**Extension shows "Disconnected":**
- Ensure EsPass app is running
- Check console in app for "[WebSocket] Server started on port 9876"
- Restart the app if needed

**Auto-fill not working:**
- Make sure you opened the site from EsPass app (not manually)
- Check browser console (F12) for EsPass logs
- Try refreshing the page after it loads

**Icons not showing:**
- Make sure you created and moved the icon files
- Refresh the extensions page after adding icons
