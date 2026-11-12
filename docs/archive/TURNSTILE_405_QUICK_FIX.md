# Turnstile 405 Error - Quick Fix Reference

## The Problem
```
[Security] Turnstile API error: 405 Method Not Allowed
```

## The Solution
**File:** `/lib/security.ts` (line 216)
**Change:** One URL

```diff
- fetch("https://challenges.cloudflare.com/turnstile/validate", {
+ fetch("https://challenges.cloudflare.com/turnstile/v0/validate", {
```

## What Changed
- **Before:** `https://challenges.cloudflare.com/turnstile/validate`
- **After:** `https://challenges.cloudflare.com/turnstile/v0/validate`
- **Difference:** Added `/v0` to the endpoint path

## Affected Flows
✅ Login page
✅ Register page  
✅ Google authentication
✅ OTP verification

## Why This Works
- `/v0/` is the correct API version endpoint
- Cloudflare Turnstile API requires the version prefix
- POST requests to the v0 endpoint are properly routed and handled

## Status
🎉 **FIXED** - Deploy to production immediately
