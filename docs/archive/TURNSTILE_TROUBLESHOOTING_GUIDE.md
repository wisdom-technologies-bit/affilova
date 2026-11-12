# Turnstile Widget Troubleshooting Guide

## Quick Diagnostic Checklist

### 1. Environment Variable Check
```bash
# Verify in Vercel project settings > Environment Variables
NEXT_PUBLIC_TURNSTILE_SITE_KEY=<your-site-key>
TURNSTILE_SECRET_KEY=<your-secret-key>
```

**If missing:**
- Go to https://dash.cloudflare.com/turnstile
- Create a new Turnstile site
- Copy site key and secret key
- Add both to Vercel project environment variables
- Redeploy or trigger new build

### 2. Browser Console Check (DevTools F12)
Open browser DevTools → Console tab while on login/signup page

**Look for errors:**
```javascript
// ✅ Good - Widget loaded
"[v0] Turnstile verification successful"

// ❌ Bad - Config error
"Security configuration error. Please contact support."

// ❌ Bad - Script failed to load
"Failed to load security verification. Please refresh the page."
```

### 3. Network Tab Check
Open DevTools → Network tab, reload page

**Look for:**
- Script download: `challenges.cloudflare.com/turnstile/v0/api.js` - Status 200
- If Status 404/403: Turnstile CDN blocked or site key invalid

### 4. Element Inspector Check
Open DevTools → Elements tab, search for `turnstile`

**Expected structure:**
```html
<div class="flex justify-center my-4">
  <div ref={turnstileRef}></div>
  <!-- After script loads, this should contain iframe -->
  <iframe src="https://challenges.cloudflare.com/cdn-cgi/..." ...></iframe>
</div>
```

**If div is empty after 5 seconds:** Widget failed to render

## Common Issues & Solutions

### Issue 1: "Security configuration error" Message
**Cause:** `NEXT_PUBLIC_TURNSTILE_SITE_KEY` environment variable not set or empty

**Solution:**
1. Check Vercel project → Settings → Environment Variables
2. Ensure `NEXT_PUBLIC_TURNSTILE_SITE_KEY` exists and has a value
3. Redeploy project
4. Wait 2 minutes for new build to deploy
5. Hard refresh browser (Ctrl+Shift+R on Windows, Cmd+Shift+R on Mac)

### Issue 2: Widget Shows for 2 Seconds Then Disappears
**Cause:** Widget token expired or callback issue

**Solution:**
1. Check browser console for "Turnstile token expired"
2. Try completing verification again
3. If persists, clear browser cache and cookies
4. Try incognito/private window

### Issue 3: Widget Never Appears After Page Reload
**Cause:** Script not persisting across page loads or multiple render attempts

**Solution:**
1. Do NOT force refresh (F5) - causes race condition
2. Use `Ctrl+F5` (full cache clear) or open DevTools > Network > Disable cache, then F5
3. Wait 5 seconds after page load
4. Try another browser

### Issue 4: CORS or Mixed Content Error
**Cause:** Website served over HTTP but Turnstile requires HTTPS

**Solution:**
- Ensure your site uses HTTPS (not HTTP)
- Check browser console for mixed content warnings
- Turnstile requires secure context

### Issue 5: "Failed to load security verification" Message After 5 Seconds
**Cause:** Script CDN timeout or network blocked

**Solution:**
1. Check internet connection
2. Disable browser extensions (ad-blockers often block Turnstile)
3. Try different network (mobile hotspot)
4. Check if corporate firewall blocks Cloudflare domains

## Advanced Debugging

### Enable Verbose Logging (Temporary)
If needed, temporarily add console logs to debug:

```javascript
// In RegisterClient.tsx or login-client.tsx useEffect
console.log("[v0] Site key available:", !!siteKey)
console.log("[v0] Window turnstile available:", !!window.turnstile)
console.log("[v0] Ref current available:", !!turnstileRef.current)
```

Then check browser console for each value.

### Test Turnstile Script Directly
In browser console, paste:
```javascript
// Check if script loaded
console.log(window.turnstile ? "✓ Turnstile loaded" : "✗ Turnstile not loaded")

// Try manual render (if loaded)
if (window.turnstile && document.getElementById('test-turnstile')) {
  window.turnstile.render('#test-turnstile', {
    sitekey: 'YOUR_SITE_KEY_HERE',
    callback: () => console.log('Verified!')
  })
}
```

### Database Verification
Check if security events are being logged in Neon:

```sql
SELECT * FROM security_audit_log 
WHERE event_type LIKE '%turnstile%'
ORDER BY created_at DESC 
LIMIT 10;
```

Should show entries like:
- `google_auth_turnstile_failed`
- `login_turnstile_verification_failed`

## Recovery Steps

### If Widget Still Not Appearing After Fixes
1. **Clear everything:**
   - Browser cache (Ctrl+Shift+Del)
   - Cookies for the site
   - Service workers (DevTools > Application > Clear storage)
   - LocalStorage (DevTools > Console > `localStorage.clear()`)

2. **Verify build deployed:**
   - Check Vercel deployments page
   - Ensure latest build is marked "Ready"
   - Wait 2-3 minutes after deployment

3. **Test in different browser:**
   - Chrome
   - Firefox
   - Safari
   - Edge

4. **Test in different environment:**
   - Preview URL from Vercel
   - Production domain
   - Local development (if applicable)

## Success Indicators

✅ Widget appears within 1 second of page load  
✅ Widget displays green checkmark after verification  
✅ Can submit form only after verification  
✅ Token persists across page reloads  
✅ Security events logged to database  
✅ No console errors or warnings  

## Support Escalation

If issues persist after all troubleshooting:

1. **Collect diagnostic info:**
   - Browser type and version
   - Error message exact text
   - Steps to reproduce
   - Screenshot of console errors

2. **Check Cloudflare status:**
   - https://www.cloudflarestatus.com/
   - Verify Turnstile service is operational

3. **Verify credentials:**
   - Log into https://dash.cloudflare.com/turnstile
   - Confirm site key matches NEXT_PUBLIC_TURNSTILE_SITE_KEY
   - Check site status is "Active"

4. **Contact Cloudflare Support:**
   - Turnstile documentation: https://developers.cloudflare.com/turnstile/
   - Include diagnostic info from step 1
