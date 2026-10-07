# Committed settings for each environment (S3-15, ADR-0013 §2): the OpenTofu version of the CDK
# app's config/environments.ts. It creates nothing. Every stack reads its environment's values from
# here, so a value lives in one place. Account IDs and the alert email aren't committed: they come
# from scripts/tofu.sh (ADR-0004 §2).

locals {
  # The web app's host in each environment (ADR-0008). The API and the sign-in pages use
  # api.<host> and auth.<host>.
  hosts = {
    dev  = "dev.cv.ikiwii.com"
    stag = "stag.cv.ikiwii.com"
    prod = "cv.ikiwii.com"
  }

  # The Vite dev server (apps/web). Only dev's app client accepts it as a sign-in callback, so the
  # web app on a laptop can sign in against dev (ADR-0009 §5).
  local_web_origin = "http://localhost:5173"

  # Monthly cost budget per account in USD (S1-09). Alerts go to CVT_ALERT_EMAIL.
  monthly_budget_usd = {
    dev  = 5
    stag = 5
    prod = 10
  }

  # Google sign-in (S2-06, ADR-0009). Each environment has its own Google OAuth client. Its ID is
  # public (Google shows it in every sign-in URL), so it's committed. Its secret isn't: it's stored
  # by hand in Secrets Manager (google-sign-in runbook). stag and prod get clients with the release
  # path (slice R).
  google_client_ids = {
    dev = "963342850841-qvv0u3e8bucs75d0amgr7ah16kveic4a.apps.googleusercontent.com"
  }

  # An environment's hosted zone for <host>, the child zones it delegates, and whether it has a
  # certificate for <host> and *.<host> (S2-03, ADR-0008). Name servers are public DNS data, so
  # they're committed. They come from the child zone's name_servers output after its first apply
  # (deploy runbook). stag gets its zone, and prod its certificate, with the release path (slice R).
  dns = {
    dev = {
      certificate = true
      delegations = {}
    }
    prod = {
      certificate = false
      delegations = {
        # The dev zone's name servers, 2026-10-02. The zone is imported, not recreated (S3-15), so
        # they don't change.
        "dev.cv.ikiwii.com" = [
          "ns-1749.awsdns-26.co.uk",
          "ns-1117.awsdns-11.org",
          "ns-155.awsdns-19.com",
          "ns-524.awsdns-01.net",
        ]
      }
    }
  }

  # The kill switch's value when its parameter is first created (S2-11, ADMIN-03). After that it's
  # changed with the AWS CLI (kill switch runbook), and an apply never resets it. stag and prod stay
  # off until their first release.
  ai_calls_initial = {
    dev  = "enabled"
    stag = "disabled"
    prod = "disabled"
  }

  # The only GitHub repository allowed to deploy (ADR-0004 §4). GitHub's immutable subject format
  # names the owner and repository by name and numeric ID, so a renamed or re-created repository
  # can't match. The IDs are public:
  #   gh api repos/dhnhut/cv-tailor --jq '{owner_id: .owner.id, repo_id: .id}'
  github_repository = {
    owner    = "dhnhut"
    owner_id = 5567608
    name     = "cv-tailor"
    id       = 1386961484
  }

  host = local.hosts[var.environment]
}
