# Account Addition & Sidebar Layout Fixes

## Issues Fixed ✅

### 1. **"activeSession is not defined" Error** 🔴
**Problem**: When clicking "Add Account" after successful connection test, got error: `activeSession is not defined`

**Root Cause**: The mail IPC module (`mail-ipc.ts`) tried to access `activeSession` and `getDb()` from `main.ts`, but they weren't in scope.

**Solution**: Modified the IPC initialization to pass getter functions for session and database.

### 2. **Sidebar Not Full Height** 🔴
**Problem**: Folders sidebar wasn't taking full available height, wasting space.

**Solution**: Added proper flex layout with `flex-1`, `min-h-0`, and overflow handling.

---

## Changes Made

### Backend Fix: activeSession Access

#### File: `electron/mail/mail-ipc.ts`

**Before** ❌:
```typescript
export function initMailIPC() {
  // ...
  if (!activeSession) {  // ❌ activeSession not defined here
    return { success: false, error: 'Not authenticated' };
  }

  const db = getDb();  // ❌ getDb not defined here
  // ...
}
```

**After** ✅:
```typescript
import { deriveEncryptionKey, encryptPassword, decryptPassword } from '../lib/encryption.js';

// Module-level variables
let getActiveSession: (() => any) | null = null;
let getDb: (() => any) | null = null;

export function initMailIPC(sessionGetter: () => any, dbGetter: () => any) {
  // Store the getters
  getActiveSession = sessionGetter;
  getDb = dbGetter;

  // ...handlers...

  // In handlers:
  const activeSession = getActiveSession?.();  // ✅ Get from getter
  if (!activeSession) {
    return { success: false, error: 'Not authenticated' };
  }

  const db = getDb?.();  // ✅ Get from getter
  // ...
}
```

#### File: `electron/main.ts`

**Before** ❌:
```typescript
initMailIPC();  // ❌ No parameters
```

**After** ✅:
```typescript
initMailIPC(
  () => activeSession,  // ✅ Pass session getter
  getDb                  // ✅ Pass database getter
);
```

---

### Frontend Fix: Sidebar Full Height

#### File: `src/mail/components/MailView.tsx`

**Before** ❌:
```tsx
{/* Folders */}
<div className="flex-1 overflow-y-auto custom-scrollbar">
  <div className="p-2 space-y-1">
    {folders.map((folder) => (
      // ...folders...
    ))}
  </div>
</div>

{/* Add Account Button */}
<div className="p-4 border-t border-[#3a3a38]">
  <button>Add Account</button>
</div>
```

**Problems**:
- Folders section didn't take full height
- No `min-h-0` to allow shrinking
- No empty state handling
- Add Account button not fixed at bottom

**After** ✅:
```tsx
{/* Folders - Full Height with Scroll */}
<div className="flex-1 overflow-y-auto custom-scrollbar min-h-0">
  <div className="p-2 space-y-1">
    {folders.length > 0 ? (
      folders.map((folder) => (
        // ...folders...
      ))
    ) : (
      <div className="px-3 py-4 text-center text-sm text-gray-500">
        No folders available
      </div>
    )}
  </div>
</div>

{/* Add Account Button - Fixed at Bottom */}
<div className="p-4 border-t border-[#3a3a38] flex-shrink-0">
  <button>Add Account</button>
</div>
```

**Benefits**:
- ✅ Takes full available height
- ✅ Scrolls when folders exceed height
- ✅ Shows empty state when no folders
- ✅ Add Account button stays at bottom

---

## How It Works Now

### Adding Account Flow

```
1. User enters email + password
   ↓
2. Click "Test Connection"
   ↓
3. "Connection successful! Both IMAP and SMTP tests passed"
   ↓
4. Click "Add Account"
   ↓
5. Backend calls: getActiveSession?.()  ← Get current session
   ↓
6. Check if user is logged in ✓
   ↓
7. Get database: getDb?.()  ← Get database instance
   ↓
8. Encrypt password with master password
   ↓
9. Store in vault as credential
   ↓
10. Link credential_id to mail account
   ↓
11. ✅ Account added successfully!
```

### Sidebar Layout

```
┌─────────────────────┐
│ Account Dropdown    │ ← Fixed height
├─────────────────────┤
│ Remove Account      │ ← Fixed height
├─────────────────────┤
│ Compose Button      │ ← Fixed height
├─────────────────────┤
│                     │
│ INBOX (5)           │
│ Sent                │ ← flex-1 with min-h-0
│ Drafts              │    Scrolls when many folders
│ Spam                │
│ Trash               │
│ ...more folders...  │
│ ↓ Scrollable        │
│                     │
├─────────────────────┤
│ Add Account Button  │ ← Fixed at bottom (flex-shrink-0)
└─────────────────────┘
```

---

## Why the Getter Pattern?

### Problem with Direct Access:
```typescript
// main.ts
let activeSession: UserSession | null = null;

// mail-ipc.ts (different module)
if (!activeSession) { }  // ❌ ReferenceError: activeSession is not defined
```

### Solution with Getters:
```typescript
// main.ts
initMailIPC(
  () => activeSession,  // Pass a function that returns activeSession
  getDb                 // Pass the getDb function
);

// mail-ipc.ts
const activeSession = getActiveSession?.();  // ✅ Get current value
const db = getDb?.();                         // ✅ Get database instance
```

**Benefits**:
- ✅ Getter always returns **current** value
- ✅ No need to export/import complex objects
- ✅ Clean separation of concerns
- ✅ Type-safe with `?.()` optional chaining

---

## CSS Classes Explained

### Flex Layout for Sidebar

```tsx
<div className="w-64 flex flex-col">  ← Container
  <div>Account Selector</div>          ← Fixed height
  <div>Remove Account</div>            ← Fixed height
  <div>Compose</div>                   ← Fixed height

  <div className="flex-1 overflow-y-auto min-h-0">  ← Grows to fill space
    Folders (scrollable)
  </div>

  <div className="flex-shrink-0">     ← Never shrinks
    Add Account
  </div>
</div>
```

| Class | Purpose |
|-------|---------|
| `flex-1` | Grow to fill available space |
| `min-h-0` | Allow shrinking below content height (important for flex children!) |
| `overflow-y-auto` | Add vertical scrollbar when content overflows |
| `flex-shrink-0` | Never shrink this element |

**Why `min-h-0`?**

Without `min-h-0`, flex items have a default `min-height: auto`, which prevents them from shrinking below their content size:

```
Without min-h-0:
┌────────────┐
│ Fixed      │
├────────────┤
│ Folders    │ ← Can't shrink! Breaks layout
│ (100 items)│
│ No scroll  │
├────────────┤
│ Button     │ ← Pushed off screen!
└────────────┘

With min-h-0:
┌────────────┐
│ Fixed      │
├────────────┤
│ Folders    │ ← Shrinks, adds scroll
│ (100 items)│
│ ↓ Scroll   │
├────────────┤
│ Button     │ ← Stays at bottom ✓
└────────────┘
```

---

## Testing

### Test 1: Add Account ✅

```
1. ✅ Go to Mail section
2. ✅ Click "Add Account"
3. ✅ Enter your email and password
4. ✅ Click "Test Connection"
5. ✅ Should show: "Connection successful! Both IMAP and SMTP tests passed"
6. ✅ Click "Add Account"
7. ✅ Should succeed (NO "activeSession is not defined" error!)
8. ✅ Should see toast: "Account added successfully!"
9. ✅ Account appears in dropdown
10. ✅ Folders sync automatically
```

### Test 2: Sidebar Full Height ✅

```
1. ✅ Open Mail section with account added
2. ✅ Look at left sidebar (folders section)
3. ✅ Should take full height from Compose button to Add Account button
4. ✅ If many folders, should show scrollbar
5. ✅ Add Account button should stay at bottom
6. ✅ Resize window - sidebar adapts correctly
```

### Test 3: Remove Account ✅

```
1. ✅ Click "Remove Account" button
2. ✅ Confirm dialog
3. ✅ Account removed successfully
4. ✅ Can re-add same account
```

---

## Console Output

### Successful Account Addition:
```
[Mail IPC] Storing mail account password in vault...
[Mail IPC] Password stored in vault with ID: 123
[Mail IPC] Account added: yourname@entegrasources.com.np
[IMAP] Connecting to mail.entegrasources.com.np:993
[IMAP] Connected successfully
[SMTP] Creating transporter for mail.entegrasources.com.np:465
```

### App Initialization:
```
Initializing database...
Database initialized
Initializing Mail module...
[Mail IPC] Initializing handlers...
[Mail DB] Tables created successfully
[Mail IPC] Handlers initialized successfully  ← Key line!
Mail module initialized
User verified in database, restoring session
```

---

## Error Handling

### If Not Logged In:
```javascript
if (!activeSession) {
  return { success: false, error: 'Not authenticated. Please log in first.' };
}
```
**User sees**: "Not authenticated. Please log in first."

### If Database Not Available:
```javascript
const db = getDb?.();
if (!db) {
  throw new Error('Database not available');
}
```
**User sees**: "Database not available"

### If Password Retrieval Fails:
```javascript
if (!credential) {
  throw new Error('Mail account password not found in vault');
}
```
**User sees**: "Mail account password not found in vault"

---

## Architecture

### Module Communication

```
┌──────────────────────────────────────────────────┐
│                   main.ts                         │
│                                                   │
│  let activeSession = { userId, masterPassword }  │
│  const getDb = () => database                    │
│                                                   │
│  initMailIPC(                                    │
│    () => activeSession,   ← Pass getter         │
│    getDb                  ← Pass function        │
│  )                                               │
└───────────────────┬──────────────────────────────┘
                    │
                    ↓ Getter functions passed
┌───────────────────┴──────────────────────────────┐
│                 mail-ipc.ts                       │
│                                                   │
│  let getActiveSession: (() => any) | null = null;│
│  let getDb: (() => any) | null = null;           │
│                                                   │
│  export function initMailIPC(sessionGetter, dbGetter) {│
│    getActiveSession = sessionGetter;  ← Store     │
│    getDb = dbGetter;                  ← Store     │
│  }                                                │
│                                                   │
│  // Later in handlers:                           │
│  const session = getActiveSession?.();  ← Call   │
│  const db = getDb?.();                  ← Call   │
└──────────────────────────────────────────────────┘
```

---

## Summary

### Before ❌
- ❌ "activeSession is not defined" error
- ❌ Could not add mail accounts
- ❌ Sidebar not full height
- ❌ Folders section too small

### After ✅
- ✅ Account addition works perfectly
- ✅ Session accessed via getter function
- ✅ Database accessed via getter function
- ✅ Sidebar takes full height
- ✅ Folders scrollable when many
- ✅ Professional layout
- ✅ Add Account button fixed at bottom

---

## Related Fixes

This builds on previous fixes:
1. ✅ Connection timeout fixes (MAIL_SYSTEM_FIXES.md)
2. ✅ Password storage fixes (PASSWORD_STORAGE_FIX.md)
3. ✅ Layout stability fixes (MAIL_LAYOUT_FIXES.md)

---

**Your mail system now allows adding accounts without errors and has a proper full-height sidebar!** 🎉📧

*Last Updated: 2025-11-24*
*Version: 1.0.6+account-fixes*
