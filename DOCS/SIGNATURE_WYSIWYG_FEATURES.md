# Email Signature WYSIWYG Editor - Feature Documentation

## ✨ Overview

The email signature editor now supports **dual-mode editing** with full HTML, CSS, and Tailwind CSS support:

1. **📝 Visual WYSIWYG Editor** - Type and format naturally
2. **🔧 HTML/CSS Mode** - Write custom HTML, CSS, and use Tailwind classes

---

## 🎯 Key Features

### 1. **Dual-Mode Editor**

Users can toggle between two editing modes:

#### Visual Mode (WYSIWYG)
- `contentEditable` div for natural typing
- Paste HTML content directly
- Real-time preview as you type
- Perfect for quick, simple signatures

#### HTML/CSS Mode
- Full HTML support
- Inline CSS styles
- **Tailwind CSS classes** (all utility classes available)
- Syntax examples provided in placeholder
- Ideal for advanced, custom-designed signatures

### 2. **Seamless Mode Switching**

- Toggle button: `📝 Visual Editor` ↔️ `🔧 HTML/CSS Mode`
- Content automatically syncs between modes
- No data loss when switching

### 3. **Live Preview**

- Separate preview section below editor
- Shows exactly how signature will appear in emails
- Updates in real-time

### 4. **Tailwind CSS Support**

Full Tailwind utility classes are available:

```html
<!-- Gradients -->
<div class="bg-gradient-to-br from-blue-500 to-purple-600">...</div>

<!-- Flexbox & Grid -->
<div class="flex items-center gap-3">...</div>

<!-- Typography -->
<h3 class="font-bold text-lg text-gray-900">...</h3>

<!-- Spacing -->
<div class="p-4 mt-3">...</div>

<!-- Colors -->
<p class="text-blue-600 hover:underline">...</p>

<!-- Borders -->
<div class="border-l-4 border-blue-500">...</div>

<!-- And 1000+ more utilities! -->
```

---

## 📋 Signature Examples

### Example 1: Simple with Tailwind

```html
<div class="font-sans text-gray-800">
  <p class="font-bold">Best regards,</p>
  <p class="text-sm">Your Name</p>
</div>
```

### Example 2: Professional with Inline Styles

```html
<div style="font-family: Arial, sans-serif; color: #333;">
  <p style="font-weight: bold; margin: 0;">John Doe</p>
  <p style="color: #666; font-size: 14px;">CEO | Company Inc.</p>
  <p style="color: #999; font-size: 12px;">📧 john@company.com | 📱 +1234567890</p>
</div>
```

### Example 3: Advanced Card with Tailwind

```html
<div class="p-4 border-l-4 border-blue-500 bg-gray-50">
  <div class="flex items-center gap-3">
    <div class="w-12 h-12 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center text-white font-bold">
      JD
    </div>
    <div>
      <h3 class="font-bold text-lg text-gray-900">Jane Doe ✨</h3>
      <p class="text-sm text-gray-600">Senior Developer</p>
    </div>
  </div>
  <div class="mt-3 text-xs text-gray-500">
    <a href="mailto:jane@example.com" class="text-blue-600 hover:underline">jane@example.com</a>
  </div>
</div>
```

---

## 🔧 Technical Implementation

### File Modified
- `src/mail/components/MailView.tsx`

### New State Variables
```typescript
const signatureEditorRef = useRef<HTMLDivElement>(null);
const [showSignatureHTMLMode, setShowSignatureHTMLMode] = useState(false);
```

### Key Components

1. **WYSIWYG Editor** (Visual Mode)
   ```tsx
   <div
     ref={signatureEditorRef}
     contentEditable
     onInput={(e) => setSignatureForm({ ...signatureForm, htmlContent: e.innerHTML })}
     onPaste={(e) => { /* Handle HTML paste */ }}
   />
   ```

2. **HTML/CSS Textarea** (Code Mode)
   ```tsx
   <textarea
     value={signatureForm.htmlContent}
     onChange={(e) => setSignatureForm({ ...signatureForm, htmlContent: e.target.value })}
     spellCheck={false}
   />
   ```

3. **Mode Toggle Button**
   ```tsx
   <button onClick={() => {
     setShowSignatureHTMLMode(!showSignatureHTMLMode);
     // Sync content between modes
   }}>
     {showSignatureHTMLMode ? '📝 Visual Editor' : '🔧 HTML/CSS Mode'}
   </button>
   ```

### Auto-Sync Logic

When switching modes:
- **Visual → HTML**: Captures `innerHTML` from contentEditable div
- **HTML → Visual**: Sets `innerHTML` of contentEditable div

---

## ✅ Email Sending Compliance

### MIME Multipart/Alternative Format

As per `mails_Rules.md`, emails are sent with **both HTML and plain text versions**:

```typescript
const draft = {
  textBody: stripHTMLTags(composeForm.body),  // Plain text fallback
  htmlBody: composeForm.body,                 // HTML with signature
};
```

**Result**: Email clients that don't support HTML will fall back to plain text, ensuring maximum compatibility.

---

## 🎨 UI/UX Features

### Visual Indicators
- **Mode Toggle**: Clear button showing current mode
- **Placeholder Text**: Helpful hints in each mode
- **Live Preview**: See signature as users type
- **Helper Tips**: Context-aware tips below editor

### Color Scheme
- Editor background: White (for visual mode), dark gray (for HTML mode)
- Syntax highlighting: Monospace font in HTML mode
- Border highlights: Orange accent on focus

### Accessibility
- Clear labels and tooltips
- Keyboard-friendly navigation
- Screen reader compatible

---

## 🚀 Usage Guide

### Creating a Signature

1. **Open Mail Manager**
   - Click "Es Mail" in sidebar
   - Click "Manage Signatures" button

2. **Create New Signature**
   - Click "Create New Signature"
   - Enter signature name (e.g., "Professional", "Personal")

3. **Design Your Signature**

   **Option A: Visual Mode** (Simple)
   - Type your signature naturally
   - Format text as needed
   - Paste from other sources

   **Option B: HTML Mode** (Advanced)
   - Click "🔧 HTML/CSS Mode"
   - Write HTML with Tailwind classes or inline styles
   - Use provided examples as templates

4. **Preview**
   - Check live preview below editor
   - Toggle between modes to verify

5. **Save**
   - Optionally check "Set as default"
   - Click "Create Signature"

### Using Signatures in Emails

1. **Manual Selection**
   - Open compose window
   - Select signature from dropdown
   - Signature auto-inserted

2. **Default Signature**
   - Marked signatures auto-load on new emails
   - No manual selection needed

---

## 📦 What's Supported

### ✅ Fully Supported

- ✅ All HTML tags (`<div>`, `<p>`, `<table>`, `<img>`, etc.)
- ✅ Inline CSS styles
- ✅ Tailwind CSS utility classes
- ✅ Custom CSS classes (if defined in global styles)
- ✅ Images (via `<img>` tags with URLs)
- ✅ Links (`<a href="...">`)
- ✅ Emojis
- ✅ Special characters
- ✅ Nested structures
- ✅ Responsive utilities (Tailwind breakpoints)

### ⚠️ Limitations

- External CSS files not supported (use inline or Tailwind)
- JavaScript not executed (security)
- iframes not supported (security)

---

## 🔒 Security

- **HTML Sanitization**: Signatures are rendered in isolated preview
- **No Script Execution**: JavaScript blocked for security
- **XSS Protection**: Content properly escaped

---

## 💡 Best Practices

1. **Use Tailwind for Modern Designs**
   - Faster than writing custom CSS
   - Responsive by default
   - Consistent styling

2. **Test in Preview**
   - Always check preview before saving
   - Verify on both light and dark backgrounds

3. **Keep It Simple**
   - Shorter signatures load faster
   - Better email client compatibility

4. **Use Semantic HTML**
   - Helps with accessibility
   - Better email client rendering

5. **Inline Styles for Critical Styling**
   - Some email clients strip Tailwind classes
   - Inline styles have better compatibility

---

## 🎉 Summary

The signature editor now offers:

✨ **Flexibility**: Choose between visual editing or code
🎨 **Customization**: Full HTML/CSS/Tailwind support
👀 **Live Preview**: See changes instantly
🔄 **Seamless Switching**: Toggle modes without data loss
📧 **Email Compliance**: Proper MIME multipart format
🚀 **Professional Results**: Create stunning email signatures

**Users can now create signatures with unlimited creativity!**
