# ADR-0008: Domain and DNS

| Field       | Value                                                                                  |
| ----------- | -------------------------------------------------------------------------------------- |
| Status      | Accepted                                                                               |
| Date        | 2026-10-01                                                                             |
| Deciders    | Project owner                                                                          |
| Sprint item | S1-13                                                                                  |
| Amended     | 2026-10-07: the zones are managed by OpenTofu's `dns` stack, and were imported (S3-15) |

## Context

The MVP is reached through the project owner's domain, `ikiwii.com`, not through generated `cloudfront.net` and `amazoncognito.com` names ([ADR-0005](0005-mvp-scope.md)). The same domain will host other projects later. The domain is registered with an external registrar, and the registrar hosts the DNS for the apex `ikiwii.com`.

Each CV Tailor environment runs in its own AWS account ([ADR-0004](0004-accounts-and-access.md)), in `us-east-1` ([ADR-0002](0002-aws-region.md)). Each environment needs names for three endpoints: the web app, the API, and the sign-in pages (Cognito managed login).

### Decision drivers

1. **Room for more projects** on the same domain without renaming this one.
2. **The account stays the boundary:** a change in `dev` can't touch `prod`'s DNS or certificates.
3. **Each project is isolated in the browser:** projects don't share an origin, so they don't share storage or cookies.
4. **Low cost and little to maintain.**

## Options Considered

### Option A: Path-based, `dev.ikiwii.com/cv`

- **Pros:** one hostname per environment for every project.
- **Cons:** every project shares one origin, so `localStorage` and cookies are shared. A script injected into one project could read another project's sign-in tokens. It also needs one CloudFront distribution that routes to several projects in different accounts, plus base-path handling in the SPA build, the router, and the Cognito callback URLs.

Rejected, because it fails drivers 2 and 3.

### Option B: Flat names, `dev-cv.ikiwii.com`

- **Pros:** one DNS zone and one wildcard certificate (`*.ikiwii.com`) cover everything.
- **Cons:** every project's and every environment's records live in one zone, so whoever can change `dev` records can change `prod` records. The API and sign-in names become long flat names (`api-dev-cv.ikiwii.com`).

Rejected, because it fails driver 2.

### Option C: A subdomain per project, then per environment, `dev.cv.ikiwii.com` (chosen)

- **Pros:** the project owns `cv.ikiwii.com`, and each environment owns its own zone below it, in its own account. Each account issues its own certificates. A future project gets `<project>.ikiwii.com` the same way.
- **Cons:** three hosted zones, at USD 0.50 per zone per month. Delegating from the `prod` zone to the `dev` and `stag` zones adds a setup step.

## Decision

### Names

| Environment | Web app              | API                      | Sign-in                   |
| ----------- | -------------------- | ------------------------ | ------------------------- |
| `prod`      | `cv.ikiwii.com`      | `api.cv.ikiwii.com`      | `auth.cv.ikiwii.com`      |
| `stag`      | `stag.cv.ikiwii.com` | `api.stag.cv.ikiwii.com` | `auth.stag.cv.ikiwii.com` |
| `dev`       | `dev.cv.ikiwii.com`  | `api.dev.cv.ikiwii.com`  | `auth.dev.cv.ikiwii.com`  |

### Zones and delegation

```text
ikiwii.com              registrar DNS (apex; shared by all projects)
└─ cv.ikiwii.com        Route 53 zone in cv-tailor-prod   ← NS records at the registrar
   ├─ stag.cv.ikiwii.com  Route 53 zone in cv-tailor-stag ← NS records in the cv.ikiwii.com zone
   └─ dev.cv.ikiwii.com   Route 53 zone in cv-tailor-dev  ← NS records in the cv.ikiwii.com zone
```

- The apex stays at the registrar, so no AWS account holds shared DNS, and the management account stays free of resources (ADR-0004).
- Each zone is defined in OpenTofu, in a `dns` stack with its own state, applied from a laptop like the `access` and `baseline` stacks, with `prevent_destroy`. CI never changes DNS zones: its role may change only the web app's, the API's, and the sign-in pages' records ([ADR-0013](0013-infrastructure-as-code-opentofu.md) §5). The zones were imported, not recreated, in the move from CDK (S3-15).
- The delegation records in the `cv.ikiwii.com` zone hold the name servers of the `dev` and `stag` zones. Those values are public DNS data, so they are committed in the environment config. No account trusts another to write its records.
- Each environment's records for its own endpoints (CloudFront, API Gateway, Cognito) live in its own zone and are deployed with its workload stage.

### Certificates

- Each account issues its own ACM certificate in `us-east-1` for `<env-host>` and `*.<env-host>`, validated through DNS in its own zone. CloudFront, API Gateway, and the Cognito custom domain all require `us-east-1` certificates for these endpoints.
- The Cognito custom domain needs its parent name to resolve, so the web app record (`<env-host>`) is created before `auth.<env-host>`.

## Consequences

### Positive

- `dev` can't change `prod` names or certificates, and each zone's cost shows in its own account.
- Another project adds `<project>.ikiwii.com` at the registrar without touching CV Tailor.
- Each project is its own origin in the browser.
- Google sign-in uses names on a domain the project owns.

### Negative

- USD 0.50 per month per environment for its hosted zone.
- Setup order matters: the `prod` zone and its registrar NS records come first, then the `dev` and `stag` zones and their delegation records.
- A re-created `dev` or `stag` zone gets new name servers, so its delegation records in the `prod` zone must be updated. Zones are retained on stack deletion to avoid that.

## Verification

1. `dig NS cv.ikiwii.com +short` returns the Route 53 name servers of the zone in `cv-tailor-prod`.
2. `dig NS dev.cv.ikiwii.com +short` returns the name servers of the zone in `cv-tailor-dev`.
3. The ACM certificate for `dev.cv.ikiwii.com` and `*.dev.cv.ikiwii.com` is `ISSUED` in `cv-tailor-dev`.
4. `https://dev.cv.ikiwii.com` serves the SPA with a valid certificate (Sprint 2, S2-02).
