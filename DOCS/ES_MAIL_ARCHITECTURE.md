# Es Mail - Separate Sandboxed Window Architecture

## Overview
Es Mail has been transformed from an integrated component into a **separate, sandboxed Electron window** that launches independently when clicked, similar to how Thunderbird works as a standalone email client.

## Key Features

✅ **Independent Window**: Runs as a separate Electron window with its own lifecycle
✅ **Sandboxed Security**: Enabled sandbox mode for enhanced security
✅ **Custom Title Bar**: Frameless window with custom minimize/maximize/close controls
✅ **Shared Database**: Accesses the same SQLite database as the main app
✅ **Full Mail Features**: All IMAP/SMTP functionality preserved
✅ **Window Management**: Can be minimized, maximized, and closed independently

## Architecture Changes

### New Files Created

1. **`mail-window.html`** - Entry point HTML for the mail window
2. **`src/mail-window.tsx`** - React entry point for the mail window
3. **`ES_MAIL_ARCHITECTURE.md`** - This documentation file

### Modified Files

1. **`electron/main.ts`**
   - Added `mailWindow` global variable
   - Created `createMailWindow()` function
   - Added IPC handlers: `open-mail-window`, `mail-window-minimize`, `mail-window-maximize`, `mail-window-close`
   - Added mail window cleanup in `before-quit` event

2. **`electron/preload.ts`**
   - Added mail window control APIs to `electronAPI` object
   - Updated channel whitelists for security

3. **`src/mail/components/MailView.tsx`**
   - Added `standalone` prop
   - Added custom title bar component (only shown when `standalone=true`)
   - Added window control buttons

4. **`src/pages/DashboardPage.tsx`**
   - Removed inline MailView rendering
   - Replaced `setShowEsMail` with `openEsMail()` function
   - Calls IPC to launch separate window

5. **`vite.config.ts`**
   - Added multiple entry points configuration
   - Included `mail-window.html` in build
   - Added mail-related dependencies to externals

6. **`package.json`**
   - Added `mail-window.html` to electron-builder files

## Window Properties

### Mail Window Configuration
```typescript
{
  width: 1400,
  height: 900,
  minWidth: 1200,
  minHeight: 700,
  frame: false,              // Frameless for custom title bar
  sandbox: true,             // Enhanced security
  contextIsolation: true,    // Security isolation
  nodeIntegration: false,    // No direct Node.js access
  webSecurity: true         // Web security enabled (in production)
}
```

## How It Works

### 1. Launching the Mail Window

**User Action**: Click "Es Mail" button in the main app

**Flow**:
```
DashboardPage.tsx
  ↓ (onClick)
openEsMail()
  ↓ (IPC send)
'open-mail-window'
  ↓ (IPC handler in main.ts)
createMailWindow()
  ↓
New BrowserWindow created
  ↓
Loads mail-window.html
  ↓
Renders MailView with standalone=true
```

### 2. Window Control

**Title Bar Actions**:
- **Minimize**: `window.electronAPI.mailWindowMinimize()` → IPC → `mailWindow.minimize()`
- **Maximize**: `window.electronAPI.mailWindowMaximize()` → IPC → `mailWindow.maximize()` / `restore()`
- **Close**: `window.electronAPI.mailWindowClose()` → IPC → `mailWindow.close()`

### 3. Database Sharing

Both the main app and mail window share the **same SQLite database** (`database.sqlite`):
- **Mail accounts**: Stored in `mail_accounts` table
- **Passwords**: Stored in vault's `credentials` table (encrypted)
- **Emails**: Cached in `mail_emails` table
- **Folders**: Stored in `mail_folders` table

## Security Features

1. **Sandboxed Process**: Mail window runs in a sandboxed environment
2. **Context Isolation**: Renderer process cannot directly access Node.js
3. **Preload Script**: Controlled API exposure via `electronAPI`
4. **Channel Whitelisting**: Only approved IPC channels allowed
5. **Encrypted Passwords**: Mail passwords stored encrypted in the vault

## Development vs Production

### Development Mode
```bash
npm run dev
```
- Mail window loads from dev server
- Hot reload enabled

### Production Mode
```bash
npm run build:local
```
- Mail window bundled into `dist/mail-window.html`
- Optimized assets
- All entry points included in build

## Testing the Mail Window

### Steps to Test:
1. **Build the app**: `npm run build:local`
2. **Run the app**: Open the built executable
3. **Login**: Authenticate with your account
4. **Click "Es Mail"**: Should open a new window
5. **Test window controls**: Minimize, maximize, close buttons
6. **Add email account**: Test the mail functionality
7. **Close and reopen**: Mail window should launch again

### Expected Behavior:
- ✅ Separate window opens with custom title bar
- ✅ Window is independent (can minimize main app, mail stays open)
- ✅ All mail features work (IMAP, SMTP, folders, emails)
- ✅ Window controls (minimize, maximize, close) function properly
- ✅ Can have both windows open simultaneously

## Troubleshooting

### Issue: Mail window doesn't open
**Check**:
1. Console logs in main app (F12)
2. IPC handler is registered (`open-mail-window`)
3. `electronAPI.openMailWindow` is defined

### Issue: Window controls don't work
**Check**:
1. Preload script includes mail window control APIs
2. Channel whitelists include: `mail-window-minimize`, `mail-window-maximize`, `mail-window-close`

### Issue: Mail window is blank
**Check**:
1. `mail-window.html` is in the build output (`dist/mail-window.html`)
2. Vite build config includes mail window entry point
3. Browser console for errors (F12 in mail window)

### Issue: Build fails
**Check**:
1. All mail dependencies are in `vite.config.ts` externals
2. `mail-window.html` path is correct in `vite.config.ts`
3. TypeScript compilation succeeds

## Future Enhancements

### Potential Improvements:
1. **Multiple Mail Windows**: Support opening multiple email accounts in separate windows
2. **Window State Persistence**: Remember window size/position
3. **Notification Integration**: System notifications for new emails
4. **Tray Icon**: Minimize to system tray
5. **Quick Compose**: Keyboard shortcut to open compose window
6. **Search in Separate Window**: Advanced search in its own window

## API Reference

### Main Process (electron/main.ts)

```typescript
// Create mail window
createMailWindow(): BrowserWindow | undefined

// IPC Handlers
ipcMain.on('open-mail-window', () => { ... })
ipcMain.on('mail-window-minimize', () => { ... })
ipcMain.on('mail-window-maximize', () => { ... })
ipcMain.on('mail-window-close', () => { ... })
```

### Renderer Process (via electronAPI)

```typescript
// Open mail window
window.electronAPI.openMailWindow()

// Mail window controls (only available in mail window)
window.electronAPI.mailWindowMinimize()
window.electronAPI.mailWindowMaximize()
window.electronAPI.mailWindowClose()
```

### MailView Component

```typescript
interface MailViewProps {
  onBack?: () => void;      // Callback for "Back" button (unused in standalone)
  standalone?: boolean;      // Whether running in standalone window
}

// Usage in main app (removed now)
<MailView onBack={() => {}} />

// Usage in mail window
<MailView standalone={true} />
```

## Comparison: Before vs After

| Feature | Before | After |
|---------|--------|-------|
| **Integration** | Inline component | Separate window |
| **Window** | Main window | Independent window |
| **Navigation** | "Back" button | Window controls |
| **Isolation** | Shared context | Sandboxed |
| **User Experience** | Tab-like | Thunderbird-like |
| **Database** | Shared | Shared (unchanged) |
| **Security** | Normal | Enhanced (sandboxed) |

## Conclusion

The Es Mail system has been successfully refactored into a **separate, sandboxed Electron application** that launches independently from the main EsPass app. This architecture provides:

- **Better user experience**: Similar to dedicated email clients
- **Enhanced security**: Sandboxed environment
- **Improved isolation**: Independent lifecycle
- **Maintained functionality**: All mail features preserved

The implementation follows Electron best practices for multi-window applications with proper IPC communication, security, and window management.
