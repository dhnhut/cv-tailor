# 08 Request Flow

**Time:** 4 hours · **Week:** 3 · **Safety:** `[No AWS]` · **Last checked:** 2026-10-09, `81f6f15`

## Goal

Follow one request, `GET /me`, from a click in the browser to the database and back, and say what each step checks. This module ties modules 05, 06, and 07 together.

## Before you start

- [05 Contracts](05-contracts.md), [06 API](06-api.md), and [07 Web](07-web.md) done.

## Learn first

Nothing new. Reread your notes from modules 06 and 07.

## The whole trip

```text
Browser                          AWS (dev account)
───────                          ─────────────────
1. GET / ──────────────────────▶ CloudFront serves index.html and the JavaScript
2. GET /config.json ───────────▶ CloudFront: apiUrl, authUrl, user pool, client ID
3. Sign in ────────────────────▶ Cognito managed login at auth.<host>
   ◀── /auth/callback?code=… ──  (code flow with PKCE; the pre sign-up trigger runs on a first Google sign-in)
4. POST /oauth2/token ─────────▶ Cognito: access, ID, and refresh tokens
5. GET https://api.<host>/me ──▶ API Gateway: the Cognito authorizer checks the access token and its scope
   Authorization: Bearer …        └─▶ Lambda cv-tailor-dev-me
                                       ├─ readCaller: sub, token_use = access, groups
                                       ├─ MeResponse.parse: the body must match the contract
                                       └─ ensureProfile ─▶ DynamoDB cv-tailor-dev-data
                                                            GetItem, then PutItem on the first call
6. ◀── 200 {"sub":…,"isAdmin":…}  The browser checks the body with MeResponse.parse again
7. Your profile page shows the email (from the ID token), the user ID, and the role
```

## Do

### R1 The hop table `[No AWS]`

Copy this table into `notes.local/request-flow.md` and fill in every empty cell from the code. Each row is one hop.

| #   | Where (file or AWS resource)                     | Function or setting | What it checks | What it logs |
| --- | ------------------------------------------------ | ------------------- | -------------- | ------------ |
| 1   | `apps/web/src/main.tsx`, `config.ts`             |                     |                |              |
| 2   | `apps/web/src/auth/settings.ts`                  |                     |                |              |
| 3   | `apps/web/src/auth/RequireAuth.tsx`              |                     |                |              |
| 4   | `apps/web/src/pages/CallbackPage.tsx`, `App.tsx` |                     |                |              |
| 5   | `apps/web/src/api.ts`                            |                     |                |              |
| 6   | `infra/modules/api/main.tf` (the authorizer)     |                     |                |              |
| 7   | `apps/api/src/handlers/claims.ts`                |                     |                |              |
| 8   | `apps/api/src/handlers/me/handler.ts`            |                     |                |              |
| 9   | `apps/api/src/data/profiles.ts`, `keys.ts`       |                     |                |              |
| 10  | `apps/api/src/handlers/http.ts`                  |                     |                |              |

<details>
<summary>Some answers, to check yourself</summary>

- Row 1: `loadConfig()` fetches `/config.json` and checks it with `WebConfig.parse`. If it fails, `StartupError` is shown.
- Row 6: the authorizer checks the token's signature and expiry against the user pool, and that it carries the `cv-tailor-api/user` scope, which only access tokens have.
- Row 7: `readCaller` checks that the claims exist, that `sub` is a string, and that `token_use` is `access`.
- Row 8: logs one JSON line with `route`, `outcome`, `isAdmin`, and `durationMs`. Never the `sub`.
- Row 9: `profileKey` refuses a `sub` that isn't a lowercase UUID, before any AWS call.

</details>

### R2 What if…? `[No AWS]`

For each case, predict the HTTP status and the code that decides it. Then find the test that proves it.

| Case                                         | Your prediction | Prove it with                                             |
| -------------------------------------------- | --------------- | --------------------------------------------------------- |
| No `Authorization` header                    |                 | `infra/stacks/workload/tests/api.tftest.hcl`              |
| An ID token instead of an access token       |                 | the same, and `apps/api/test/handlers/me/handler.test.ts` |
| The table is unavailable                     |                 | `apps/api/test/handlers/me/handler.test.ts`               |
| A `sub` that isn't a lowercase UUID          |                 | `apps/api/test/handlers/me/handler.test.ts`               |
| The API's answer has an extra field, `email` |                 | `apps/web/test/api.test.ts`                               |
| The API answers 401 to the web app           |                 | `apps/web/test/App.test.tsx`                              |

<details>
<summary>Answers</summary>

- **No header, or an ID token:** `401`, from API Gateway's authorizer, before any Lambda runs. Every route requires an access token with the API scope ("Every route needs an access token with the API scope." in `api.tftest.hcl`).
- **An ID token that somehow got past the authorizer:** `500`. `readCaller` returns nothing, because `token_use` isn't `access`; the handler treats it as a misconfiguration (test: "refuses an ID token, if one ever gets past the authorizer").
- **The table is unavailable:** `500` with `{"message":"Internal server error"}`, and a log line with only the error's name (test: "returns a 500 with no detail when the table fails, and logs only the error name").
- **A bad `sub`:** `500`, and nothing is written (test: "refuses a sub that breaks the contract, and writes nothing").
- **An extra field:** the API's own `MeResponse.parse` would refuse it before sending, so it never leaves the API. If it did, the web app's `MeResponse.parse` refuses it too: `strictObject` rejects unknown keys (test: "fails when the body breaks the contract").
- **A 401 to the web app:** the session is cleared and sign-in starts again (test: "when the API refuses the token, the session is cleared and sign-in starts again").

</details>

### R3 Draw it `[No AWS]`

In `notes.local/`, draw the trip from memory as a sequence diagram: browser, Cognito, API Gateway, Lambda, DynamoDB. Then compare it with the one above.

Stretch: do the same for the document upload: `apps/api/src/handlers/documents/create.ts` → `createDocument` in `apps/api/src/documents/service.ts` → `presignUpload` in `apps/api/src/storage/documents-bucket.ts` → the browser's `PUT` to S3 → `GET /documents` (`list.ts`) → `DELETE /documents/{id}` (`delete.ts`).

## Verify

Without notes, you can explain the trip in under five minutes, and say where the token is checked and where the contract is checked.

## Check your understanding

1. Where is the token checked, and why twice?

   <details>
   <summary>Answer</summary>

   First by API Gateway's authorizer (signature, expiry, scope). Then by `readCaller` (`token_use` must be `access`), as a second line of defence if the API were ever misconfigured.

   </details>

2. Where is the contract checked, and why twice?

   <details>
   <summary>Answer</summary>

   In the API before it sends (`MeResponse.parse` in the handler), so a wrong body is never sent; and in the browser when it arrives (`api.ts`), so an API change shows up as an error, not as a wrong value on screen.

   </details>

3. On your computer, why does the web app call `/me` on its own address, and not `https://api.dev.cv.ikiwii.com/me`?

   <details>
   <summary>Answer</summary>

   The API's CORS allows only the deployed web app's origin. Vite's proxy forwards the call server to server, where CORS doesn't apply (`apiBase` in `api.ts`, `proxy` in `vite.config.ts`).

   </details>

4. Your mentor adds you to the `admin` group. When does your profile page say "Admin"?

   <details>
   <summary>Answer</summary>

   After you get new tokens, for example by signing out and in again. The group is read from the access token, and a token issued before the change still says the old groups until it expires.

   </details>

## If you get stuck

Pick one hop, open its file, and ask your AI tutor to explain only that file.
