# Providers Login OAuth NodeBridge Handlers

**Date:** 2026-02-01

## Context

The OAuth login logic for GitHub Copilot and Antigravity providers was embedded directly in `src/slash-commands/builtin/login.tsx` React component. This tight coupling prevented reuse in browser-based versions of the application, where the UI layer differs but the OAuth flow logic remains the same.

The goal was to extract OAuth-related logic into NodeBridge handlers, making it accessible via the message bus for any frontend (CLI, browser, etc.).

## Discussion

### OAuth Flow Differences

Two OAuth providers have different flows:
- **GitHub Copilot (Device Code Flow)**: User visits URL, enters code, backend polls GitHub until authorized
- **Antigravity (Redirect Flow)**: Browser redirects to auth URL, callback receives code

### Explored Approaches

**Option A: Two-Step Handlers**
- `initOAuth` returns authUrl + sessionId
- `completeOAuth` takes code + sessionId, saves token
- Clean separation, works for redirect-based browser OAuth
- Chosen initially for Antigravity

**Option B: Single Handler with Callback URL**
- Server holds connection open, waits for callback
- Too complex for browser context

**Option C: Polling-Based Flow**
- `initOAuth` returns authUrl + pollId
- `pollOAuth` returns current status (pending/completed/error)
- Required for GitHub Copilot's device code flow where internal polling happens in oauth-providers library

### Key Insight

GitHub Copilot's `tokenPromise` internally polls GitHub's API. Without awaiting it, the auth never completes. The solution was to store the promise and track its resolution state asynchronously, exposing status via a non-blocking `pollOAuth` handler.

## Approach

Combine approaches A and C:
1. **`initOAuth`**: Start OAuth, store provider instance and tokenPromise, return authUrl + sessionId
2. **`pollOAuth`**: Non-blocking check if tokenPromise resolved, complete flow if so
3. **`completeOAuth`**: For redirect flows where browser provides the code directly
4. **`status`**: Check if provider is already logged in

This allows:
- CLI to poll `pollOAuth` until completion
- Browser to either poll or use `completeOAuth` for redirect flows
- Both flows share the same backend handlers

## Architecture

### New Handler Types

```typescript
'providers.login.initOAuth': {
  input: { cwd: string; providerId: 'github-copilot' | 'antigravity'; timeout?: number };
  output: { authUrl: string; userCode?: string; oauthSessionId: string };
}

'providers.login.pollOAuth': {
  input: { cwd: string; oauthSessionId: string };
  output: { status: 'pending' | 'completed' | 'error'; user?: string; error?: string };
}

'providers.login.completeOAuth': {
  input: { cwd: string; providerId; oauthSessionId: string; code: string };
  output: { user?: string };
}

'providers.login.status': {
  input: { cwd: string; providerId: string };
  output: { isLoggedIn: boolean; user?: string };
}
```

### Session Storage

```typescript
interface OAuthSession {
  provider: GithubProvider | AntigravityProvider;
  providerId: string;
  createdAt: number;
  cleanup?: () => void;
  tokenPromise?: Promise<string>;
  resolved: boolean;
  resolvedToken?: string;
  resolvedError?: string;
}
```

Sessions stored in-memory Map with 5-minute TTL, cleaned up on each `initOAuth` call.

### Flow Diagram

```
CLI/Browser                          NodeBridge
    |                                    |
    |--- initOAuth ------------------->  |
    |                                    | Create provider, call initAuth()
    |                                    | Store tokenPromise, track resolution
    |<-- { authUrl, oauthSessionId } --- |
    |                                    |
    | (Show URL to user)                 | (tokenPromise polling internally)
    |                                    |
    |--- pollOAuth ------------------->  |
    |<-- { status: 'pending' } --------- |
    |                                    |
    | (repeat polling)                   | (user authorizes on provider site)
    |                                    |
    |--- pollOAuth ------------------->  |
    |                                    | tokenPromise resolved!
    |                                    | Exchange token, save to config
    |<-- { status: 'completed', user } - |
```

### Files Modified

1. `src/nodeBridge.types.ts` - Handler type definitions
2. `src/nodeBridge/slices/providers.ts` - Handler implementations
3. `src/slash-commands/builtin/login.tsx` - Refactored to use handlers, removed direct oauth-providers imports
