# The committed settings for each environment (modules/settings), which every stack reads. They
# replace the CDK app's config/environments.ts and its tests. Plan-only, with no provider calls.

run "dev" {
  command = plan

  module {
    source = "../../modules/settings"
  }

  variables {
    environment = "dev"
  }

  assert {
    condition = (
      output.region == "us-east-1"
      && output.host == "dev.cv.ikiwii.com"
      && output.web_origin == "https://dev.cv.ikiwii.com"
      && output.name_prefix == "cv-tailor-dev"
    )
    error_message = "dev runs at dev.cv.ikiwii.com in us-east-1."
  }

  assert {
    condition     = output.web_origins == ["https://dev.cv.ikiwii.com", "http://localhost:5173"]
    error_message = "Only dev also accepts sign-in callbacks from the Vite dev server."
  }

  assert {
    condition     = output.monthly_budget_usd == 5 && output.ai_calls_initial == "enabled"
    error_message = "dev has a USD 5 budget, and AI calls start enabled."
  }

  assert {
    condition     = output.google_client_id == "963342850841-qvv0u3e8bucs75d0amgr7ah16kveic4a.apps.googleusercontent.com"
    error_message = "dev has Google sign-in."
  }

  assert {
    condition     = output.dns.certificate && length(output.dns.delegations) == 0
    error_message = "dev has a certificate and delegates no child zones."
  }
}

run "stag" {
  command = plan

  module {
    source = "../../modules/settings"
  }

  variables {
    environment = "stag"
  }

  assert {
    condition     = output.host == "stag.cv.ikiwii.com" && output.web_origins == ["https://stag.cv.ikiwii.com"]
    error_message = "stag runs at stag.cv.ikiwii.com, with no local origin."
  }

  assert {
    condition     = output.dns == null && output.google_client_id == null
    error_message = "stag gets DNS and Google sign-in with the release path (slice R)."
  }

  assert {
    condition     = output.monthly_budget_usd == 5 && output.ai_calls_initial == "disabled"
    error_message = "stag has a USD 5 budget, and AI calls start disabled."
  }
}

run "prod" {
  command = plan

  module {
    source = "../../modules/settings"
  }

  variables {
    environment = "prod"
  }

  assert {
    condition     = output.host == "cv.ikiwii.com" && output.web_origins == ["https://cv.ikiwii.com"]
    error_message = "prod runs at cv.ikiwii.com."
  }

  assert {
    condition     = output.monthly_budget_usd == 10 && output.ai_calls_initial == "disabled"
    error_message = "prod has a USD 10 budget, and AI calls start disabled."
  }

  assert {
    condition = output.dns == {
      certificate = false
      delegations = {
        "dev.cv.ikiwii.com" = ["ns-1749.awsdns-26.co.uk", "ns-1117.awsdns-11.org", "ns-155.awsdns-19.com", "ns-524.awsdns-01.net"]
      }
    }
    error_message = "prod's zone delegates dev.cv.ikiwii.com to the dev zone's name servers, and has no certificate yet."
  }

  assert {
    condition     = output.github_subject == "repo:dhnhut@5567608/cv-tailor@1386961484:environment:prod"
    error_message = "prod's deploy role trusts the prod GitHub Environment only."
  }
}

run "refuses_an_unknown_environment" {
  command = plan

  module {
    source = "../../modules/settings"
  }

  variables {
    environment = "test"
  }

  expect_failures = [var.environment]
}
