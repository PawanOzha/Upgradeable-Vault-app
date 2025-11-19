# EsPass v1.2.0 - Security Enhanced Release

**Release Date:** November 7, 2025  
**Build Status:** ✅ Ready  
**Security Level:** 🟡 Improved (4 critical fixes remaining)

---

## 🎯 What's New in v1.2.0

### 🔒 Major Security Improvements

#### 1. **256-bit App ID Security**
- **Before:** 12 characters (48-bit) - Bruteforceable
- **After:** 64 characters (256-bit) - Cryptographically secure
- **Impact:** 4.14×10^62 times more secure
- **Auto-migration** from old App IDs

#### 2. **Rate Limiting Protection**
- **WebSocket Pairing:** Max 5 attempts/min → 5-min lockout
- **Credential Requests:** Max 20 requests/min → 5-min lockout  
- **Login Attempts:** Max 5 attempts → Progressive lockout (5-30 min)
- **Prevents:** Brute force attacks, DoS attacks, password spraying

#### 3. **Session Security**
- **Expiration:** 30 days (previously unlimited)
- **Device Binding:** Session tied to specific PC
- **Validation:** Checks expiry + device on every startup
- **Auto-logout:** On device change or session expiry

### ✨ UI/UX Improvements

#### Clean App ID Display
- Shows: `A1B2C...` (first 5 chars only)
- **Copy Button:** One-click copy with icon
- **Visual Feedback:** ✓ checkmark on copy
- **Toast Notification:** "App ID copied!" (green popup)
- **Tooltip:** Hover for instructions

### 📦 Files in This Release

```
vault/release/
├── EsPass Setup 1.2.0.exe          ← Windows installer (NSIS)
├── EsPass Setup 1.2.0.exe.blockmap ← Update verification
├── win-unpacked/
│   └── EsPass.exe                  ← Portable executable
└── latest.yml                      ← Auto-update manifest
```
