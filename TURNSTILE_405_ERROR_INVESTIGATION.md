# Turnstile 405 Method Not Allowed - Investigation Report

## Issue Summary
The application is experiencing a "405 Method Not Allowed" error from Cloudflare Turnstile API during token verification in login, registration, and Google authentication flows.

## Root Cause Analysis

### Problem Identified
In `/lib/security.ts`, the `verifyTurnstileToken` function is using an **incorrect HTTP method and endpoint**:

```typescript
// INCORRECT - Current Implementation
const response = await fetch("https://challenges.cloudflare.com/turnstile/validate", {
  method: "POST",  // This is correct
  headers: {
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    secret,
    response: token,
    remoteip: remoteIP,
  }),
})
```

**Issue:** The endpoint URL is wrong. Cloudflare's Turnstile API expects:
- **Correct Endpoint:** `https://challenges.cloudflare.com/turnstile/v0/validate`
- **Current Endpoint:** `https://challenges.cloudflare.com/turnstile/validate` (missing `/v0`)

### Why This Causes 405 Error
1. The `/turnstile/validate` path doesn't exist in Cloudflare's routing
2. Requests are being routed to a handler that only accepts GET requests
3. When the server receives a POST to a path that expects GET, it returns **405 Method Not Allowed**

### Affected Flows
1. **Login** (`/app/api/auth/login/route.ts`) - calls `verifyTurnstileToken`
2. **Registration** (`/app/api/auth/send-otp/route.ts`) - calls `verifyTurnstileToken`
3. **Google Auth** (`/app/api/auth/google/route.ts`) - calls `verifyTurnstileToken`

All three are failing at the security verification step.

## Solution
Replace the Turnstile endpoint URL with the correct v0 API endpoint that includes proper error handling.

## Files to Update
1. `/lib/security.ts` - Fix `verifyTurnstileToken` function

## Impact
This fix will resolve:
- ✅ Login page security verification errors
- ✅ Registration page security verification errors
- ✅ Google authentication security verification errors
- ✅ All Turnstile-dependent authentication flows
