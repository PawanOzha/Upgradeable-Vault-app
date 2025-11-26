# Test Email Signatures

Copy and paste these test signatures to verify both Tailwind CSS and inline styles are working:

---

## Test 1: Inline Styles Only (✅ Works Everywhere)

```html
<div style="font-family: Arial, sans-serif; padding: 16px; background: linear-gradient(to right, #3b82f6, #8b5cf6); color: white; border-radius: 8px;">
  <h3 style="font-weight: bold; font-size: 20px; margin: 0 0 8px 0;">John Doe ✨</h3>
  <p style="font-size: 14px; margin: 0; opacity: 0.9;">CEO | Tech Company Inc.</p>
  <p style="font-size: 12px; margin: 8px 0 0 0;">📧 john@company.com | 📱 +1 (555) 123-4567</p>
</div>
```

**Expected Result**: Blue-to-purple gradient background, white text, rounded corners

---

## Test 2: Tailwind Classes Only (✅ Works in Your App, ❌ May Not Work in Gmail/Outlook)

```html
<div class="p-4 bg-gradient-to-r from-blue-500 to-purple-600 text-white rounded-lg">
  <h3 class="font-bold text-xl mb-2">Jane Smith ✨</h3>
  <p class="text-sm opacity-90 mb-0">CTO | Innovation Labs</p>
  <p class="text-xs mt-2">📧 jane@labs.com | 📱 +1 (555) 987-6543</p>
</div>
```

**Expected Result in App**: Same as Test 1 (gradient, rounded, etc.)
**Expected Result in Gmail**: Plain text, no styling (classes stripped)

---

## Test 3: Hybrid Approach (✅ Works Everywhere - RECOMMENDED)

```html
<div class="p-4 bg-gradient-to-r from-blue-500 to-purple-600 text-white rounded-lg" style="font-family: Arial, sans-serif; padding: 16px; background: linear-gradient(to right, #3b82f6, #8b5cf6); color: white; border-radius: 8px;">
  <h3 class="font-bold text-xl mb-2" style="font-weight: bold; font-size: 20px; margin: 0 0 8px 0;">Alex Johnson ✨</h3>
  <p class="text-sm opacity-90 mb-0" style="font-size: 14px; margin: 0; opacity: 0.9;">VP of Engineering</p>
  <p class="text-xs mt-2" style="font-size: 12px; margin: 8px 0 0 0;">📧 alex@company.com | 📱 +1 (555) 456-7890</p>
</div>
```

**Expected Result**:
- In your app: Beautiful with Tailwind classes
- In Gmail/Outlook: Beautiful with inline styles
- Best of both worlds! ✅

---

## Test 4: Professional Card with Tailwind

```html
<div class="max-w-md p-6 bg-white border-l-4 border-blue-500 shadow-sm" style="max-width: 448px; padding: 24px; background: white; border-left: 4px solid #3b82f6; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
  <div class="flex items-center gap-4 mb-4" style="display: flex; align-items: center; gap: 16px; margin-bottom: 16px;">
    <div class="w-16 h-16 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center text-white font-bold text-2xl" style="width: 64px; height: 64px; background: linear-gradient(135deg, #3b82f6, #8b5cf6); border-radius: 9999px; display: flex; align-items: center; justify-content: center; color: white; font-weight: bold; font-size: 24px;">
      MK
    </div>
    <div>
      <h3 class="text-gray-900 font-bold text-lg mb-1" style="color: #111827; font-weight: bold; font-size: 18px; margin: 0 0 4px 0;">Maria Kim</h3>
      <p class="text-gray-600 text-sm mb-0" style="color: #4b5563; font-size: 14px; margin: 0;">Senior Product Designer</p>
    </div>
  </div>
  <div class="text-xs text-gray-500 space-y-1" style="font-size: 12px; color: #6b7280;">
    <p style="margin: 4px 0;">📧 <a href="mailto:maria@design.com" class="text-blue-600 hover:underline" style="color: #2563eb; text-decoration: none;">maria@design.com</a></p>
    <p style="margin: 4px 0;">🌐 <a href="https://mariakim.design" class="text-blue-600 hover:underline" style="color: #2563eb; text-decoration: none;">mariakim.design</a></p>
    <p style="margin: 4px 0;">📱 +1 (555) 234-5678</p>
  </div>
</div>
```

**Expected Result**: Professional card with avatar, gradient circle, clean layout

---

## Test 5: Simple Text Signature

```html
<div style="font-family: Arial, sans-serif; font-size: 14px; color: #333;">
  <p style="margin: 0; font-weight: bold;">Best regards,</p>
  <p style="margin: 4px 0 0 0; font-weight: bold; color: #2563eb;">Robert Chen</p>
  <p style="margin: 4px 0 0 0; color: #666; font-size: 13px;">Marketing Director | Global Brands Co.</p>
  <p style="margin: 8px 0 0 0; color: #999; font-size: 12px;">
    📧 robert@globalbrands.com<br>
    📱 +1 (555) 345-6789<br>
    🌐 www.globalbrands.com
  </p>
</div>
```

**Expected Result**: Classic simple signature, works everywhere

---

## How to Test

1. **Open Your Mail App**
   - Click "Es Mail" in sidebar
   - Click "Manage Signatures"

2. **Create New Signature**
   - Click "Create New Signature"
   - Enter name: "Test 1" (or whichever test you're trying)

3. **Switch to HTML Mode**
   - Click "🔧 HTML/CSS Mode" button

4. **Paste Test Code**
   - Copy one of the HTML blocks above
   - Paste into the textarea

5. **Check Preview**
   - Look at the "Preview" section below
   - Should show styled signature

6. **Test Both Modes**
   - Click "📝 Visual Editor" to see WYSIWYG mode
   - Click "🔧 HTML/CSS Mode" to go back
   - Content should sync between modes

7. **Save and Use**
   - Click "Create Signature"
   - Use in compose window to verify

---

## Verification Checklist

### ✅ In Preview Section
- [ ] Gradient backgrounds render
- [ ] Rounded corners appear
- [ ] Colors are correct
- [ ] Font sizes apply
- [ ] Spacing looks right

### ✅ In Compose Window
- [ ] Signature appears when selected from dropdown
- [ ] Styling is preserved
- [ ] Can type above signature

### ✅ In Sent Email (View in Your Inbox)
- [ ] Inline styles work (Test 1, 3, 4, 5)
- [ ] Tailwind classes work in your app (Test 2, 3, 4)
- [ ] Layout is correct

### ⚠️ Send to External Email (Gmail/Outlook)
- [ ] Test 1 (inline only) - Should work ✅
- [ ] Test 2 (Tailwind only) - May not work ❌
- [ ] Test 3 (hybrid) - Should work ✅
- [ ] Test 4 (hybrid) - Should work ✅
- [ ] Test 5 (inline only) - Should work ✅

---

## Current Status

**Implementation**:
- ✅ Tailwind CDN added to email iframe (line 2317)
- ✅ Inline styles fully supported
- ✅ WYSIWYG editor working
- ✅ HTML/CSS mode working
- ✅ Preview rendering correctly

**What Works**:
- ✅ **Inline styles**: Work everywhere (in-app + external email clients)
- ✅ **Tailwind classes**: Work in your app (preview, viewing emails)
- ⚠️ **Tailwind in Gmail/Outlook**: Classes stripped, use hybrid approach

**Recommendation**: Use **Test 3** or **Test 4** (hybrid approach) for production signatures!
