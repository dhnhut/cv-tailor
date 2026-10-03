# ADR-0009: Sign-In and API Access

| Field       | Value                                                                                                                                                                                                                                                                                     |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Status      | Accepted                                                                                                                                                                                                                                                                                  |
| Date        | 2026-10-02                                                                                                                                                                                                                                                                                |
| Amended     | 2026-10-02: the app client's sign-in flows, PKCE, and the refresh grace period are recorded, and point 3 is corrected: a user can sign in through the Cognito API (S2-05); 2026-10-03: Google sign-in settings and where the Google client secret is kept are recorded in point 4 (S2-06) |
| Deciders    | Project owner                                                                                                                                                                                                                                                                             |
| Sprint item | S2-02                                                                                                                                                                                                                                                                                     |

## Context

Sprint 2 adds sign-in with email/password and Google (AUTH-01, AUTH-02) and the first API endpoint, `GET /me`. `AGENTS.md` §7 names Amazon Cognito for sign-in and AWS API Gateway for the API. Earlier decisions depend on how sign-in works:

- Every item in the data table is keyed by the user's Cognito `sub` ([ADR-0006](0006-data-store.md)), and so is each candidate's knowledge base identity ([ADR-0007](0007-knowledge-base-store.md)). If a person's `sub` changes, they lose their data.
- The web app, the API, and the sign-in pages have their own names: `<env-host>`, `api.<env-host>`, and `auth.<env-host>` ([ADR-0008](0008-domain-and-dns.md)).
- Personal data is kept out of logs, memory, and model inputs where possible (SAFE-04).

Two points were decided when Sprint 2 was planned (S2-01): a password sign-up confirms its email with a code before the first sign-in, and Cloudflare Turnstile protects sign-up before the first `prod` release. This ADR records them with the details they need, and settles the rest:

1. How each person keeps one `sub` for life.
2. When a Google sign-in is linked to an existing account.
3. Email verification at sign-up (decided).
4. User pool settings.
5. How the web app signs in and where it keeps tokens.
6. The API Gateway type, and which token the API accepts.
7. The `admin` group.
8. Sign-up protection with Cloudflare Turnstile (decided).

Numbers in square brackets refer to [Sources](#sources).

### Decision drivers

1. **One identity per person, for life.** The `sub` never changes, whichever sign-in method a person uses first.
2. **No account takeover.** Linking never gives an account to someone who hasn't proved they own its email address.
3. **Little custom security code.** Managed components do the security-critical work where they can.
4. **Low cost.** No fixed monthly cost at low traffic. The `dev` budget is USD 5 per month.
5. **Room for later controls,** such as per-client throttling and AWS WAF (`AGENTS.md` §8).

## Decisions

### 1. One `sub` per person, for life

How Cognito links identities:

- A third-party identity, such as a Google account, can be linked to an existing user only before that identity's first sign-in. Once Cognito has created a profile for it, that profile must be deleted before the identity can be linked [1].
- After the link, the person always signs in to the linked user, with that user's `sub` [1][2].
- AWS advises against setting passwords on profiles that Cognito creates for federated users. Link them to local users instead [1].
- A user can have up to five linked identities [1].

| Option                                                                                                            | Pros                                                            | Cons                                                                                                                                                |
| ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| A. Allow Google-only profiles, and link them later where possible                                                 | No user is created by our code.                                 | A person who starts with Google and later adds a password ends up with two users and two `sub`s, unless one is deleted. Fails driver 1.             |
| B. Every person is a local (email) user. Google identities are linked into it before their first sign-in (chosen) | The `sub` is always the local user's `sub`. Follows AWS advice. | The pre sign-up trigger must create the local user when a person's first sign-in is with Google. That is custom code, tested case by case in S2-07. |

**Decision: B.** No Google-only profile is ever created. On a person's first Google sign-in, the pre sign-up trigger links the Google identity to their local user, and creates that local user first if it doesn't exist yet. The rules are in point 2.

| Order of sign-in methods     | What happens                                                                                                   | `sub`            |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------- | ---------------- |
| Password only                | A local user is created at sign-up.                                                                            | The local user's |
| Password first, Google later | The Google identity is linked to the local user at its first sign-in.                                          | The local user's |
| Google first, password later | The trigger creates the local user and links Google. Later, the person sets a password with "Forgot password". | The local user's |
| Google only                  | The trigger creates the local user and links Google.                                                           | The local user's |

A different email address is a different person. The system never merges two local users.

### 2. Account-linking rules

Facts the rules rely on:

- Google identifies a person by `sub`, not by email address. Google is authoritative for an email address only for Gmail addresses, and for Google Workspace accounts, which carry an `hd` claim. For any other address, Google recommends another check [3][4].
- The link itself uses Google's `sub`, not the email address [2].
- With email as the username, Cognito refuses a sign-up for an email address that another user already has [5].
- An unconfirmed user can't sign in. Its confirmation code is valid for 24 hours [6].
- The pre sign-up trigger runs for `SignUp` (`PreSignUp_SignUp`), for `AdminCreateUser` (`PreSignUp_AdminCreateUser`), and on a federated user's first sign-in (`PreSignUp_ExternalProvider`) [7][8].
- The trigger must answer within 5 seconds, and Cognito may retry it. Managed login shows the trigger's error text above the sign-in form [8].

**Decision:** the pre sign-up trigger (S2-07) applies these rules.

| #   | Case                                                                                                                             | Trigger source               | Action                                                                                                                                       | Result                                                                     | What the user sees                                                                                                            |
| --- | -------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| 1   | Password sign-up with a new email address                                                                                        | `PreSignUp_SignUp`           | Allow, after the Turnstile check (point 8).                                                                                                  | A new local user, unconfirmed until the emailed code is entered (point 3). | The code screen.                                                                                                              |
| 2   | Password sign-up with an email address that already has a local user, including one created for a Google sign-in                 | None. Cognito refuses first. | None.                                                                                                                                        | No new user.                                                               | "An account with this email already exists." They sign in with Google, or set a password with "Forgot password" (same `sub`). |
| 3   | First Google sign-in. A local user with this email exists and its email is verified.                                             | `PreSignUp_ExternalProvider` | Link the Google identity to the local user.                                                                                                  | Signed in as the local user (same `sub`).                                  | Signed in.                                                                                                                    |
| 4   | First Google sign-in. No local user has this email.                                                                              | `PreSignUp_ExternalProvider` | Create the local user with the email marked verified and a random password that nobody knows, confirm it, then link the Google identity [6]. | A new local user.                                                          | Signed in. They can add a password later with "Forgot password".                                                              |
| 5   | First Google sign-in. A local user with this email exists but is unconfirmed (the takeover case).                                | `PreSignUp_ExternalProvider` | Never link. Delete the unconfirmed user, then continue as case 4.                                                                            | A new local user with a different `sub`. The unconfirmed sign-up is gone.  | Signed in.                                                                                                                    |
| 6   | First Google sign-in, and Google doesn't vouch for the address: `email_verified` is false, or the address isn't a Gmail address. | `PreSignUp_ExternalProvider` | Refuse.                                                                                                                                      | No user.                                                                   | An error that asks them to sign up with their email address and a password.                                                   |
| 7   | First Google sign-in. A local user with this email is confirmed, but its email isn't verified.                                   | `PreSignUp_ExternalProvider` | Refuse.                                                                                                                                      | No change.                                                                 | An error that asks them to sign in with their password.                                                                       |
| 8   | An admin creates a user, or the trigger does in case 4.                                                                          | `PreSignUp_AdminCreateUser`  | Allow.                                                                                                                                       | A new local user.                                                          | Nothing.                                                                                                                      |
| 9   | A later Google sign-in, after the identity is linked.                                                                            | None.                        | None.                                                                                                                                        | Signed in as the same local user.                                          | Signed in.                                                                                                                    |

Why the rules look like this:

- **Case 5 is a known attack, account pre-hijacking** [9]. An attacker signs up with someone else's email address. They can't confirm it, so they wait for the real owner to arrive through Google. Linking would put the owner's Google identity, and later their data, into an account whose password the attacker chose. The unconfirmed user has never signed in, so it holds no data. Deleting it frees the address for its owner.
- **Only Gmail addresses are trusted.** Linking by a verified Gmail address is no weaker than email-based password reset, which already lets the owner of an address take over its account.
  - Google Workspace accounts would also be safe. But the pre sign-up trigger sees only mapped attributes, so the `hd` claim would need a permanent custom attribute or the inbound federation trigger [10].
  - Workspace accounts are planned for a later phase. Until then, Workspace accounts, and Google accounts with other addresses, sign up with a password.
- **Only Google is trusted for linking.** Another provider, such as LinkedIn after S2-13, gets its own rule in this ADR before it is turned on.
- **The trigger's steps can be repeated safely.** If Cognito retries the trigger, it finds the user it already created, and links it only if the link is missing.
- **The first Google sign-in after a link may fail.** Developers have reported an error on that sign-in, with the next attempt succeeding [11]. S2-07 checks this live. If it still happens, the web app retries the sign-in once when it sees that error.

### 3. Email verification at sign-up (decided)

**Decision (made in S2-01):** a password sign-up confirms its email address with a code before the first sign-in, and a changed email address is used only after it is verified.

- **Confirmation code:** a password sign-up confirms its email address with an emailed code before the first sign-in. This is Cognito's default. The code is valid for 24 hours [6].
- **Email changes:** the user pool keeps the original email address in use until a new one is verified (`AttributesRequireVerificationBeforeUpdate`) [6]. An unverified address never becomes the account's email, so it can't be used to link a Google identity.
- **No self-service attribute changes in the web app:** the web app doesn't request the `aws.cognito.signin.user.admin` scope, so its tokens can't change user attributes through the Cognito API [12]. The MVP has no screen for changing an email address.
  - Managed login offers only the sign-in flows that the app client allows [44], so the client allows SRP (point 5). The same setting lets a user sign in through the Cognito API with their own password. That token has only the `aws.cognito.signin.user.admin` scope [20]. It can change the user's own attributes, but a new email address still isn't used until it's verified, and the API rejects the token because it has no API scope (point 6).
  - Only AWS WAF can block sign-in through the Cognito API [45], and WAF is out of scope for the MVP.
- **Reason:** it needs no extra code, and in the MVP an unverified account couldn't use any paid feature anyway.
- **Later:** optional verification, where verified accounts get a higher quota (AUTH-03), comes with tiers in a later release.

### 4. User pool settings

Feature plans [13][14]:

| Plan                | Price per monthly active user (MAU)                            | What it adds                                                                              | Verdict                                                              |
| ------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Lite                | USD 0.0055 above 10,000 free MAU                               | Sign-up, sign-in, federation, and the classic hosted UI                                   | Rejected: no managed login, passkeys, or access-token customization. |
| Essentials (chosen) | USD 0.015 above 10,000 free MAU. The free tier doesn't expire. | Managed login, passkeys, email MFA, password reuse prevention, access-token customization | Covers every MVP need at USD 0.                                      |
| Plus                | USD 0.020, no free tier                                        | Checks for breached passwords and risky sign-ins, and activity logs                       | Not yet. See "When to revisit".                                      |

Users who sign in with Google count toward the 10,000 free MAU. Users from OIDC providers such as LinkedIn have only 50 free MAU [14].

**Decision:** the Essentials plan, with these settings.

| Setting               | Decision                                                                                                                                       | Reason                                                                                                                                                                                                                                                                                                                                                                                                            |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sign-in identifier    | Email address as the username. Case-insensitive. Email is required.                                                                            | Gives one local user per email address, which point 2 relies on. It can't be changed after the user pool is created [5].                                                                                                                                                                                                                                                                                          |
| Self-registration     | On                                                                                                                                             | The web app's sign-up form calls the `SignUp` API, which is refused when self-registration is off [15].                                                                                                                                                                                                                                                                                                           |
| Password              | At least 8 characters. No rules about character types.                                                                                         | Easy to create. NIST SP 800-63B-4 asks for 15 characters when the password is the only factor, and says not to require character types [16]. See the note below the table.                                                                                                                                                                                                                                        |
| MFA                   | Off                                                                                                                                            | Managed login prompts users to set up MFA only when MFA is required. Optional MFA needs our own setup screens [19]. Requiring it for every candidate adds friction, and Google users get no Cognito MFA anyway [19].                                                                                                                                                                                              |
| Account recovery      | By verified email only                                                                                                                         | Email is the only contact attribute.                                                                                                                                                                                                                                                                                                                                                                              |
| User existence errors | Prevented at sign-in and password reset                                                                                                        | Sign-up still shows whether an address is registered, because the address is the username [5]. Turnstile (point 8) limits automated probing.                                                                                                                                                                                                                                                                      |
| Tokens                | Access and ID tokens: 60 minutes. Refresh token: 1 day, rotated on every use, with a 10-second grace period. Token revocation on.              | **Access and ID tokens:** AWS advises at least one hour when managed login is used, because its session cookie lasts one hour [20]. **Refresh token:** rotation never extends its window, which RFC 10017 requires for browser apps [21][25]. **Grace period:** a refresh retried within 10 seconds, for example after a network error, still works [21]. **Revocation:** on by default for new app clients [22]. |
| Email sender          | Cognito's default sender in `dev`. Amazon SES with a verified `cv.ikiwii.com` domain, out of the SES sandbox, before the first `prod` release. | The default sender is limited to 50 emails a day per account, and AWS says that is below typical production volume [23][24].                                                                                                                                                                                                                                                                                      |
| Deletion protection   | On. The user pool is retained when its stack is deleted.                                                                                       | Users, their passwords, and their `sub`s can't be re-created.                                                                                                                                                                                                                                                                                                                                                     |

**Password trade-off:** the 8-character minimum is accepted for now.

- **Lockout:** after 5 failed attempts, Cognito locks the user out for 1 second, and the lock doubles with each further failure up to about 15 minutes [17].
- **No password needed:** Google sign-in avoids passwords entirely.
- **No breached-password check:** Essentials doesn't check for breached passwords; Plus does [13]. Password reuse prevention is available but not turned on [18].

**Google sign-in (S2-06):**

- **Scopes:** `openid` and `email` only. The name and photo that Google's `profile` scope adds aren't needed (SAFE-04).
- **Attribute mapping:** `email` and `email_verified`. Cognito stores a mapped email address as unverified unless `email_verified` is mapped [46], and point 2 links only verified addresses. An app client can't be given write access to `email_verified`, so users can't mark their own address as verified [47].
- **Clients:** one Google OAuth client per environment, each in its own Google Cloud project. The client ID is public, because Google shows it in every sign-in URL, so it's committed in `infra/config/environments.ts`.
- **Client secret:** a Secrets Manager secret, `cv-tailor/google-client-secret`, created by hand in each environment and never committed. CloudFormation reads it when it creates or changes the identity provider. An SSM SecureString can't be used: CloudFormation resolves those only for a short list of resource properties, and the Cognito identity provider isn't one of them [48]. A Secrets Manager reference works in any property [49]. It costs USD 0.40 per month per environment.

### 5. Web app sign-in

RFC 10017 (BCP 212) describes three patterns for browser apps [25]:

| Option                                                    | Pros                                                                                                                                                                                                                                            | Cons                                                                                                                                                                                                                         |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A. Browser-based OAuth client (§6.3) (chosen for the MVP) | AWS runs the token checks. The web app uses a standard library, with no session store. Cognito meets RFC 10017's requirements for this pattern: PKCE, refresh tokens that rotate, and a maximum lifetime that rotation doesn't extend [21][25]. | The tokens are in the browser. A script injected into the page can steal the refresh token and use the account until the token expires. RFC 10017 strongly recommends a BFF for applications that handle personal data [25]. |
| B. Backend-for-Frontend (BFF) (§6.1)                      | Tokens never reach the browser. An injected script can act only while the page is open, and signing out ends the session at once.                                                                                                               | We would build and maintain a session store, cookie handling, CSRF protection, and a Lambda authorizer. It adds about two to three days to Sprint 2.                                                                         |
| C. Token-mediating backend (§6.2)                         | The refresh token stays on the server.                                                                                                                                                                                                          | Most of B's work, with less of its protection.                                                                                                                                                                               |

**Decision: A for the MVP. B is the planned upgrade** (see "When to revisit").

**Why A is acceptable for now:** in every pattern, the first defence against an injected script is to stop it from running. RFC 10017 notes that no frontend measure stops an injected script from getting fresh tokens [25]. So the web app follows three rules:

- It keeps a strict content security policy (S2-04).
- It never renders model output as raw HTML.
- It loads no third-party scripts except Turnstile.

| Part          | Decision                                                                                                                                                                          | Reason                                                                                                                                                                                                                                                                                               |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Flow          | Authorization code flow with PKCE, through managed login at `auth.<env-host>`. A public app client with no secret. Callback URLs on `<env-host>`, plus `localhost` in `dev` only. | RFC 10017 requires PKCE for public clients [25]. A browser app can't keep a secret. Cognito has no setting that requires PKCE [45], so the web app's library always sends it.                                                                                                                        |
| Sign-in flows | `ALLOW_USER_SRP_AUTH` only                                                                                                                                                        | Managed login offers the flows that the app client allows [44], and SRP gives it password sign-in. Refresh token rotation doesn't work with `ALLOW_REFRESH_TOKEN_AUTH`, so the web app refreshes tokens through the token endpoint [21]. Custom authentication doesn't work with managed login [44]. |
| Scopes        | `openid`, `email`, and the API scope (point 6)                                                                                                                                    | Without `aws.cognito.signin.user.admin`, tokens can't change user attributes [12].                                                                                                                                                                                                                   |
| Library       | `oidc-client-ts` 3.x with `react-oidc-context` 3.x [26][27]                                                                                                                       | Standards-based, actively maintained, with React bindings. Amplify JS v6 was the alternative. It is maintained by AWS, but stores tokens in localStorage by default and adds its own configuration model [28]. Writing the OAuth flow by hand was rejected.                                          |
| Token storage | sessionStorage, the library's default                                                                                                                                             | Cleared when the tab closes, and not shared between tabs. localStorage would keep tokens across browser restarts. Memory-only storage would make every page reload a new sign-in.                                                                                                                    |
| Sign-out      | Revoke the refresh token, clear the stored tokens, then redirect to Cognito's `/logout` with `client_id` and `logout_uri` [22][29]                                                | `/logout` clears the managed login session cookie. It doesn't sign the user out of Google [29].                                                                                                                                                                                                      |

### 6. API Gateway type and token

REST APIs and HTTP APIs compared [30]:

| Feature                                           | REST API                                                                                   | HTTP API                                                          |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| Cognito authorizer                                | Cognito user pool authorizer. With scopes on a method, it accepts only access tokens [31]. | JWT authorizer. It also checks the app client (`client_id`) [32]. |
| Per-client throttling, API keys, usage plans      | Yes                                                                                        | No                                                                |
| AWS WAF                                           | Yes                                                                                        | No                                                                |
| Response streaming                                | Yes                                                                                        | No                                                                |
| Request validation, X-Ray tracing, execution logs | Yes                                                                                        | No                                                                |
| CORS                                              | Preflight methods, plus headers returned by each Lambda [35]                               | Built in [43]                                                     |
| Price (US East, first tier) [33]                  | USD 3.50 per million requests                                                              | USD 1.00 per million requests                                     |

**Decision: a REST API** with a regional endpoint at `api.<env-host>`. Features on the roadmap need it, or would need extra components with an HTTP API:

- **Streaming:** a REST API can stream a Lambda response for up to 15 minutes, which suits chatbot replies [42]. An HTTP API would need a second kind of endpoint.
- **AWS WAF:** attaches directly to a REST API, which protects the public chatbot page (CHAT-02) later. An HTTP API would need CloudFront and WAF in front of it [30].
- **Observability:** X-Ray tracing and execution logs at the gateway [30].

**Trade-offs:**

- **Extra work:** most of it is CORS. A REST API needs preflight methods, CORS headers from each Lambda, and CORS headers on gateway responses. An HTTP API handles CORS itself [35][43].
- **Price:** a few cents a month at the expected volume. 100,000 requests a month cost USD 0.35 instead of USD 0.10 [33].
- **Switching later:** possible, but it means rebuilding the API layer and changing every handler's event type, so it gets more expensive as endpoints are added.

- **Access tokens only:** every method uses a Cognito user pool authorizer and requires one custom scope from a resource server defined in the user pool, for example `cv-tailor-api/user` [12]. When a method has scopes, API Gateway treats the token as an access token and checks its scopes. An ID token, which has no scopes, gets `401` [31].
- **App client not checked:** the authorizer doesn't check which app client a token was issued to. With one app client that's acceptable. A future second client must not be given the API scope unless it should call the API.
- **Usage plans don't limit per user:** they identify clients by API key, not by signed-in user, and AWS applies their limits on a best-effort basis [34]. Per-user cost control comes from the quota (QUOTA-01 to QUOTA-04), which uses atomic counters ([ADR-0006](0006-data-store.md)). If per-user rate limits are ever needed, WAF rate-based rules or a Lambda authorizer that supplies a usage key are the options.
- **CORS:** the API allows only the web app's origin. The authorizer's `401` is a gateway response (`UNAUTHORIZED`) [36], so S2-09 adds CORS headers to the gateway responses. Otherwise the web app can't read errors.
- **Revocation:** revoked tokens still pass signature and expiry checks until they expire [22]. The access-token lifetime (point 4) is the upper bound.

**What `GET /me` returns.** Access tokens carry `sub`, `cognito:groups`, `scope`, and `client_id`, but not the email address [20].

| Option                                                                                          | Pros                                                                                      | Cons                                                                                                                 |
| ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| A. `/me` returns `sub` and admin status. The web app shows the email from the ID token (chosen) | No email address in access tokens, API requests, or API logs (SAFE-04). No extra trigger. | S2-09's acceptance criterion changes.                                                                                |
| B. A pre token generation trigger adds `email` to access tokens [37]                            | `/me` can return the email address.                                                       | The email address is in every access token and every API request. One more Lambda runs every time tokens are issued. |
| C. The API accepts ID tokens                                                                    | The email address is available.                                                           | ID tokens are meant for the client, not for APIs. AWS recommends requiring scopes for API authorization [32].        |

**Decision: A.** The API neither receives nor stores email addresses.

### 7. The `admin` group

**Decision:** a Cognito user pool group whose members are changed by hand with the AWS CLI. The API reads membership from the access token.

- **Defined in CDK:** a user pool group named `admin`.
- **Membership is changed by hand:** an admin is added or removed with `aws cognito-idp admin-add-user-to-group` or `admin-remove-user-from-group`, as a runbook describes (S2-05). No API or screen changes group membership.
- **How the API sees it:** the API reads the `cognito:groups` claim, an array, from the verified access token [20]. A user is an admin when the array contains `admin`. A membership change takes effect when the user's next tokens are issued, within one access-token lifetime.
- **What it decides:** the group isn't mapped to an IAM role. In the MVP it decides the quota (QUOTA-03, built in Sprint 6). The kill switch is turned on and off with the AWS CLI, not in the app (S2-11).

### 8. Sign-up protection with Cloudflare Turnstile (decided)

**Decision (made in S2-01):** Cloudflare Turnstile on the web app's own sign-up form, checked by the pre sign-up trigger, before the first `prod` release.

**Flow**

1. The web app's own sign-up form shows the Turnstile widget and sends its token in the `ValidationData` of the `SignUp` request [7].
2. For `PreSignUp_SignUp`, the trigger sends the token to Turnstile's `siteverify` endpoint with the secret key [38].
3. It accepts the sign-up only when all of these hold:
   - `success` is true.
   - `hostname` is the web app's host.
   - `action` is the sign-up action.
4. A token is valid for 300 seconds and can be checked only once. An `idempotency_key` makes a retried check safe [38].
5. `AdminCreateUser` and first Google sign-ins carry no token, and skip the check.

**Secret key**

- An SSM Parameter Store SecureString, `/cv-tailor/turnstile-secret`, in each environment (`AGENTS.md` §7).
- It is created by hand with the AWS CLI and is never committed. CloudFormation never sees its value.
- The trigger reads it when it runs, with `ssm:GetParameter` on that one parameter.
- The site key is public. It goes in the web app's `config.json` (S2-04).

**Fail closed.** If an environment requires Turnstile and any of the following happens, the sign-up is refused:

- The check fails.
- The check times out. The trigger keeps the call short, to stay within Cognito's 5-second limit [8].
- The secret key can't be read.

**Correction to S2-01: managed login's "Sign up" link can't be hidden**

- The link disappears only when self-registration is off, and that also blocks the `SignUp` API [15].
- The branding editor has no setting for it [39].

So the link stays. A sign-up through it carries no token, so the trigger refuses it. Managed login shows the trigger's message, which points to the web app's sign-up page [8].

**When:** before the first `prod` release. Until then, `dev` uses managed login's sign-up page, with the check off.

**Cost and CSP:** Turnstile's free plan has unlimited challenges and up to 20 widgets [40]. The content security policy must allow `https://challenges.cloudflare.com` in `script-src` and `frame-src` [41].

**Scope change:** this moves CAPTCHA from slice I into the MVP ([ADR-0005](0005-mvp-scope.md), amended).

## Consequences

### Positive

- A person keeps one `sub`, whatever sign-in methods they use and in whatever order, so their data and knowledge base documents stay theirs.
- Linking never gives an account to someone who hasn't proved they own its email address.
- AWS runs the security-critical parts: password storage, the sign-in pages, and token signing and checking.
- Sign-in costs USD 0 at the expected volume, and the API costs cents.
- The REST API keeps per-client throttling, WAF, and response streaming available.

### Negative

- **Tokens are in the browser.** A script injected into the page could steal a refresh token that works for up to one day.
- **Weak passwords are possible.** The password minimum is below NIST's guidance for a single factor, and Essentials doesn't check for breached passwords.
- **The pre sign-up trigger is custom security code** with a 5-second limit. A bug in it affects every first Google sign-in.
- **Some Google accounts can't sign in with Google.** Google Workspace accounts, and Google accounts with non-Gmail addresses, must use email and password.
- **Revoked access tokens keep working briefly.** API Gateway accepts one until it expires, for up to one hour.
- **A user can sign in through the Cognito API** and change their own attributes, because managed login needs a password flow on the app client. A new email address still needs verification, and the API rejects those tokens.
- **The "Sign up" link stays on managed login.** Once Turnstile is required, it only shows an error that points to the web app's sign-up form.
- **Unconfirmed sign-ups block their email address.** Nothing removes them automatically yet, except a Google sign-in by the address's owner (case 5).
- **CORS needs more setup on a REST API** than on an HTTP API.
- **Two choices are permanent:** the sign-in identifier (email as username) and the required attributes can't be changed after the user pool is created.
- **The Google client secret can be read through Cognito.** Cognito returns it to anyone allowed to describe the identity provider [50]. The runbook's commands use `--query` to keep it out of terminal output.
- **A rotated Google client secret doesn't reach Cognito by itself.** CloudFormation reads a secret only when the resource that uses it changes [49], so the [Google sign-in runbook](../runbooks/google-sign-in.md) pushes it to Cognito.
- **The CloudFormation execution role must be able to read the Google client secret.** This matters when that role is scoped down ([ADR-0004](0004-accounts-and-access.md) §5).

### Risks and mitigations

| Risk                                                                                                                          | Mitigation                                                                                                                                                   |
| ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| The first Google sign-in after a link fails [11].                                                                             | S2-07 checks it live. If it still happens, the web app retries the sign-in once when it sees that error.                                                     |
| The trigger misses its 5-second limit: a cold start, the nested `AdminCreateUser` call, and the Turnstile check all add time. | A small handler with short timeouts, and steps that can safely run again. S2-07 measures how long it takes.                                                  |
| A bug in the trigger links the wrong accounts.                                                                                | One test per case in point 2, including the takeover case (S2-07). The trigger's IAM policy allows only the Cognito actions it uses, on this user pool only. |
| A script is injected into the web app.                                                                                        | A strict content security policy (S2-04). Model output is never rendered as raw HTML. No third-party scripts except Turnstile.                               |
| Cognito's default sender reaches its limit of 50 emails a day.                                                                | Enough for `dev`. Amazon SES is set up before the first `prod` release (slice R).                                                                            |
| Unconfirmed sign-ups hold other people's email addresses.                                                                     | Turnstile limits automated sign-ups. A Google sign-in by the owner frees the address (case 5). A clean-up job is added if this becomes a problem.            |

### When to revisit this decision

- **Move to a BFF (option B in point 5)** when any one of these happens:
  - before the public chatbot pages (later release J),
  - if the content security policy must allow third-party scripts other than Turnstile,
  - if a review finds a way to inject scripts into the web app.
- **Before real users beyond testers:** turn on passkeys or MFA, and weigh the Plus plan's breached-password check, so the password policy can stay simple.
- **Google Workspace sign-in, planned for a later phase:** read the `hd` claim with the inbound federation trigger [10], and add a linking rule for Workspace accounts.
- **Per-user rate limits are needed beyond the quota:** add WAF rate-based rules, or a Lambda authorizer that supplies a usage key.
- **LinkedIn passes S2-13:** add its linking rule to point 2 before it is turned on.

## Verification

1. **User pool settings (S2-05):** `aws cognito-idp describe-user-pool --user-pool-id <id> --profile cvt-dev` shows:
   - the Essentials tier,
   - `UsernameAttributes` set to `email`,
   - MFA `OFF`,
   - a password policy with a minimum length of 8 and no character-type rules,
   - `AttributesRequireVerificationBeforeUpdate` set to `email`,
   - deletion protection active.
2. **App client settings (S2-05):** `aws cognito-idp describe-user-pool-client` shows:
   - only the authorization code grant,
   - `ExplicitAuthFlows` set to `ALLOW_USER_SRP_AUTH` only,
   - no client secret,
   - the token lifetimes in point 4,
   - token revocation on,
   - refresh token rotation on, with a 10-second grace period.
3. **Linking (S2-07):** in `dev`, each case in point 2 gives the `sub` it lists. In the takeover case, the Google sign-in gets a different `sub` from the unconfirmed user.
4. **API authorizer (S2-09):** `curl -s -o /dev/null -w '%{http_code}' https://api.dev.cv.ikiwii.com/me` prints `401`. It prints `401` with an ID token, and `200` with an access token.
5. **Admin group (S2-09):** after a user is added to `admin`, `GET /me` shows them as an admin once their next tokens are issued.
6. **Sign-out (S2-10):** after sign-out, the old refresh token can't get new tokens.
7. **Turnstile (before the first `prod` release):** in an environment that requires Turnstile, a sign-up through managed login is refused, and a sign-up through the web app's form with a valid token succeeds.
8. **Google sign-in (S2-06):** `aws cognito-idp describe-identity-provider --user-pool-id <id> --provider-name Google --query 'IdentityProvider.{Scopes:ProviderDetails.authorize_scopes,Mapping:AttributeMapping}' --profile cvt-dev` shows the scopes `openid email` and a mapping for `email` and `email_verified`. The `--query` keeps the client secret out of the output. A Google sign-in through managed login gives a user whose `email_verified` is `true`.

## Sources

Accessed 2026-10-01 to 2026-10-03.

1. Linking federated users to an existing user profile: <https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-user-pools-identity-federation-consolidate-users.html>
2. `AdminLinkProviderForUser`: <https://docs.aws.amazon.com/cognito-user-identity-pools/latest/APIReference/API_AdminLinkProviderForUser.html>
3. Google, OpenID Connect: <https://developers.google.com/identity/openid-connect/openid-connect>
4. Google, Verify the Google ID token on your server side: <https://developers.google.com/identity/gsi/web/guides/verify-google-id-token>
5. Working with user attributes: <https://docs.aws.amazon.com/cognito/latest/developerguide/user-pool-settings-attributes.html>
6. Signing up and confirming user accounts: <https://docs.aws.amazon.com/cognito/latest/developerguide/signing-up-users-in-your-app.html>
7. Pre sign-up Lambda trigger: <https://docs.aws.amazon.com/cognito/latest/developerguide/user-pool-lambda-pre-sign-up.html>
8. Customizing user pool workflows with Lambda triggers: <https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-user-pools-working-with-lambda-triggers.html>
9. A. Sudhodanan and A. Paverd, "Pre-hijacked accounts: An Empirical Study of Security Failures in User Account Creation on the Web", USENIX Security 2022: <https://www.usenix.org/conference/usenixsecurity22/presentation/sudhodanan>
10. Inbound federation Lambda trigger: <https://docs.aws.amazon.com/cognito/latest/developerguide/user-pool-lambda-inbound-federation.html>
11. "How to link a Cognito account with a Google account", AWS Community Builders, 2022-12-29: <https://dev.to/aws-builders/how-to-link-a-cognito-account-with-a-google-accountsource-code-full-stack-1o9p>
12. Scopes, M2M, and resource servers: <https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-user-pools-define-resource-servers.html>
13. User pool feature plans: <https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-sign-in-feature-plans.html>
14. Amazon Cognito pricing: <https://aws.amazon.com/cognito/pricing/>
15. Configuring policies for user creation: <https://docs.aws.amazon.com/cognito/latest/developerguide/user-pool-settings-admin-create-user-policy.html>
16. NIST SP 800-63B-4, Digital Identity Guidelines: Authentication and Authenticator Management, §3.1.1.2: <https://pages.nist.gov/800-63-4/sp800-63b.html>
17. Authentication with Amazon Cognito user pools, lockout behavior: <https://docs.aws.amazon.com/cognito/latest/developerguide/authentication.html>
18. Passwords, account recovery, and password policies: <https://docs.aws.amazon.com/cognito/latest/developerguide/managing-users-passwords.html>
19. Adding MFA to a user pool: <https://docs.aws.amazon.com/cognito/latest/developerguide/user-pool-settings-mfa.html>
20. Understanding the access token: <https://docs.aws.amazon.com/cognito/latest/developerguide/amazon-cognito-user-pools-using-the-access-token.html>
21. Refresh tokens: <https://docs.aws.amazon.com/cognito/latest/developerguide/amazon-cognito-user-pools-using-the-refresh-token.html>
22. Ending user sessions with token revocation: <https://docs.aws.amazon.com/cognito/latest/developerguide/token-revocation.html>
23. Email settings for Amazon Cognito user pools: <https://docs.aws.amazon.com/cognito/latest/developerguide/user-pool-email.html>
24. Quotas in Amazon Cognito: <https://docs.aws.amazon.com/cognito/latest/developerguide/quotas.html>
25. RFC 10017 (BCP 212), OAuth 2.0 for Browser-Based Applications: <https://www.rfc-editor.org/rfc/rfc10017.html>
26. `oidc-client-ts`, version 3.5.0: <https://github.com/authts/oidc-client-ts>
27. `react-oidc-context`, version 3.3.1: <https://github.com/authts/react-oidc-context>
28. Amplify, Tokens and credentials: <https://docs.amplify.aws/react/build-a-backend/auth/concepts/tokens-and-credentials/>
29. The managed login sign-out endpoint: <https://docs.aws.amazon.com/cognito/latest/developerguide/logout-endpoint.html>
30. Choose between REST APIs and HTTP APIs: <https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-vs-rest.html>
31. Integrate a REST API with an Amazon Cognito user pool: <https://docs.aws.amazon.com/apigateway/latest/developerguide/apigateway-enable-cognito-user-pool.html>
32. Control access to HTTP APIs with JWT authorizers: <https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-jwt-authorizer.html>
33. Amazon API Gateway pricing: <https://aws.amazon.com/api-gateway/pricing/>
34. Usage plans and API keys for REST APIs: <https://docs.aws.amazon.com/apigateway/latest/developerguide/api-gateway-api-usage-plans.html>
35. CORS for REST APIs: <https://docs.aws.amazon.com/apigateway/latest/developerguide/how-to-cors.html>
36. Gateway response types: <https://docs.aws.amazon.com/apigateway/latest/developerguide/supported-gateway-response-types.html>
37. Pre token generation Lambda trigger: <https://docs.aws.amazon.com/cognito/latest/developerguide/user-pool-lambda-pre-token-generation.html>
38. Turnstile, Server-side validation: <https://developers.cloudflare.com/turnstile/get-started/server-side-validation/>
39. The branding editor and customizing managed login: <https://docs.aws.amazon.com/cognito/latest/developerguide/managed-login-brandingeditor.html>
40. Turnstile, Plans: <https://developers.cloudflare.com/turnstile/plans/>
41. Turnstile, Content Security Policy: <https://developers.cloudflare.com/turnstile/reference/content-security-policy/>
42. Stream the integration response for your proxy integrations: <https://docs.aws.amazon.com/apigateway/latest/developerguide/response-transfer-mode.html>
43. Configure CORS for HTTP APIs: <https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-cors.html>
44. Authentication with Amazon Cognito user pools: <https://docs.aws.amazon.com/cognito/latest/developerguide/authentication.html>
45. `CreateUserPoolClient`: <https://docs.aws.amazon.com/cognito-user-identity-pools/latest/APIReference/API_CreateUserPoolClient.html>
46. Mapping IdP attributes to profiles and tokens: <https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-user-pools-specifying-attribute-mapping.html>
47. Application-specific settings with app clients: <https://docs.aws.amazon.com/cognito/latest/developerguide/user-pool-settings-client-apps.html>
48. CloudFormation, Get a secure string value from Systems Manager Parameter Store: <https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/dynamic-references-ssm-secure-strings.html>
49. CloudFormation, Get a secret or secret value from Secrets Manager: <https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/dynamic-references-secretsmanager.html>
50. `UpdateIdentityProvider` (its describe response includes `client_secret`): <https://docs.aws.amazon.com/cognito-user-identity-pools/latest/APIReference/API_UpdateIdentityProvider.html>
