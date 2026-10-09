# 07 Web

**Time:** 7 hours · **Week:** 2 · **Safety:** `[No AWS]`, then `[Dev sign-in]` · **Last checked:** 2026-10-09, `81f6f15`

## Goal

Understand how the web app starts, signs you in, calls the API, and shows the answer. Watch it happen in your browser.

## Before you start

- [06 API](06-api.md) done.
- Your `dev` test account from [03 Setup](03-setup.md).

## Learn first

- [02 Learning path](02-learning-path.md): 9 (React) and 10 (OAuth, PKCE, and JWT).

## Read

All paths are in `apps/web/`.

1. `index.html`, `src/main.tsx`, and `src/config.ts`. Look for: the settings come from `/config.json`, checked by the `WebConfig` contract, **before** React shows anything.
2. `src/App.tsx`. Look for: the routes (`/`, `/auth/callback`, `/profile`), and `RequireAuth` around the profile page.
3. `src/auth/settings.ts`. Look for: the code flow (`response_type: 'code'`), the API scope, and why tokens live in `sessionStorage` ([ADR-0009](../adr/0009-sign-in-and-api-access.md) §5).
4. `src/auth/RequireAuth.tsx`, `src/pages/CallbackPage.tsx`, `src/auth/return-path.ts`, and `src/auth/callback-error.ts`. Look for: the round trip to Cognito and back, and two security checks: only same-site return paths, and only known error messages.
5. `src/api.ts` and `src/pages/ProfilePage.tsx`. Look for: the `Bearer` access token, the contract check on the answer, and what happens on a 401.
6. `vite.config.ts`. Look for: the proxy to `dev` (module 03).
7. Tests: `test/api.test.ts`, then `test/App.test.tsx` with `test/auth-helpers.tsx`. Look for: the whole app runs in the test, and only the network and the redirects are replaced.

### Sign-in, in plain words

```text
1. You open /profile. RequireAuth sees no session and calls signinRedirect.
2. The library makes a random secret (the PKCE verifier), keeps it in sessionStorage,
   and sends your browser to Cognito with only its hash (the challenge).
3. You sign in on Cognito's page. Cognito sends you back to /auth/callback?code=…&state=…
4. The library posts the code and the secret to Cognito's token endpoint. Cognito checks that the
   secret matches the hash, and returns three tokens: access, ID, and refresh.
5. You land back on /profile. ProfilePage calls GET /me with the access token.
```

A stolen code is useless without the secret, which never left your browser. That's what PKCE is for.

## Do

Use [the practice routine](README.md#the-practice-routine) for W2 and W3.

### W1 Run one test file `[No AWS]`

```bash
pnpm --filter @cv-tailor/web exec vitest run test/auth/return-path.test.ts
```

Expected: `Tests  9 passed (9)`. Read each case's name: they are the attacks `returnPath` must refuse.

### W2 Open a redirect hole `[No AWS]`

In `src/auth/return-path.ts`, replace the regular expression `/^\/(?![/\\])/` with the weaker `/^\//`. Predict which cases fail, then run W1's command again.

Expected: 2 failures: "falls back to / for a protocol-relative URL" and "falls back to / for a backslash URL". A browser treats `//evil.com` as another website, so the weaker check would let a crafted sign-in send you off the site after sign-in: an "open redirect". Reset.

### W3 Remove a guard `[No AWS]`

In `src/auth/RequireAuth.tsx`, change `if (mustSignIn && !started.current) {` to `if (mustSignIn) {`. Run:

```bash
pnpm --filter @cv-tailor/web exec vitest run test/App.test.tsx
```

Expected: 2 failures: "a signed-out visit to the profile goes to sign-in once, and never calls the API" and "in StrictMode, a signed-out visit still starts only one sign-in". React runs effects twice in development (StrictMode), and the auth state changes again while the redirect starts; the `ref` makes sure sign-in starts once. Reset.

### W4 Watch it in your browser `[Dev sign-in]`

Start the web app (`pnpm --filter @cv-tailor/web dev`), open `http://localhost:5173`, and open your browser's developer tools (F12) on the **Network** tab, with **Preserve log** on. Sign out if you're signed in, then open `/profile`. Find, in order:

1. `config.json`;
2. a request to `auth.dev.cv.ikiwii.com/oauth2/authorize`, with `code_challenge_method=S256` in its address;
3. your return to `/auth/callback?code=…&state=…`;
4. a `POST` to `/oauth2/token`;
5. `GET /me`, with an `Authorization: Bearer …` request header.

Then open the **Application** (or **Storage**) tab → **Session Storage**: the tokens are there, and they go away when you close the tab.

Never copy a token out of your browser, and never paste one anywhere (rule 8).

### W5 Why localhost `[Dev sign-in]`

Open `http://127.0.0.1:5173` and click **Sign in**.

Expected: Cognito shows an error page, and its address contains `error=redirect_mismatch`. Explain why, using [03 Setup](03-setup.md#6-run-the-web-app-dev-sign-in).

## Verify

You can describe the sign-in round trip in five steps, and say which token goes to the API.

## Check your understanding

1. What runs before React shows anything?

   <details>
   <summary>Answer</summary>

   `loadConfig()` fetches `/config.json` and checks it with `WebConfig`. If that fails, the app shows `StartupError` instead.

   </details>

2. Why `sessionStorage` and not `localStorage`?

   <details>
   <summary>Answer</summary>

   ADR-0009 §5: `sessionStorage` is cleared when the tab closes, so tokens don't stay on the computer.

   </details>

3. Which token is sent to the API, and where does the email on the profile page come from?

   <details>
   <summary>Answer</summary>

   The access token goes to the API. The email comes from the ID token, which stays in the browser; the API never sees it (SAFE-04).

   </details>

4. What does the web app do when the API answers 401?

   <details>
   <summary>Answer</summary>

   It clears the session (`removeUser`), so `RequireAuth` starts sign-in again.

   </details>

## If you get stuck

- The Network tab is empty after the redirect: turn on **Preserve log**, then try again.
- Sign-in loops back to Cognito: clear the site's session storage, close the tab, and start again from `http://localhost:5173`.
