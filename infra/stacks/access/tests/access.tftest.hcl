# The access stack: GithubDeployRole, its trust, its policy, and the workload permissions boundary
# (ADR-0004 §4, ADR-0013 §5). No AWS access: the provider is mocked, and every run only plans.
# Policies are compared statement by statement, so any change to what CI may do shows up here.

mock_provider "aws" {
  override_data {
    target = data.aws_kms_alias.state
    values = { target_key_arn = "arn:aws:kms:us-east-1:111111111111:key/state" }
  }
}

variables {
  environment = "dev"
  account_id  = "111111111111"
}

run "stack_wires_the_dev_settings" {
  command = plan

  assert {
    condition     = module.settings.github_subject == "repo:dhnhut@5567608/cv-tailor@1386961484:environment:dev"
    error_message = "The trusted subject must be GitHub's immutable format for this repository and the dev Environment."
  }

  assert {
    condition     = module.settings.host == "dev.cv.ikiwii.com"
    error_message = "The dev role may change records under dev.cv.ikiwii.com only."
  }
}

run "deploy_role" {
  command = plan

  module {
    source = "../../modules/oidc"
  }

  variables {
    region                    = "us-east-1"
    host                      = "dev.cv.ikiwii.com"
    github_subject            = "repo:dhnhut@5567608/cv-tailor@1386961484:environment:dev"
    state_key_arn             = "arn:aws:kms:us-east-1:111111111111:key/state"
    google_client_secret_name = "cv-tailor/google-client-secret"
    workload_iam = {
      role_path     = "/cv-tailor/workload/"
      boundary_name = "CvTailorWorkloadBoundary"
      boundary_path = "/cv-tailor/"
    }
  }

  # --- Trust ---

  assert {
    condition = jsondecode(aws_iam_role.deploy.assume_role_policy).Statement == [{
      Effect    = "Allow"
      Principal = { Federated = "arn:aws:iam::111111111111:oidc-provider/token.actions.githubusercontent.com" }
      Action    = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = {
          "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
          "token.actions.githubusercontent.com:sub" = "repo:dhnhut@5567608/cv-tailor@1386961484:environment:dev"
        }
      }
    }]
    error_message = "Only this repository's dev Environment may assume the role, with an exact sub (no wildcards)."
  }

  assert {
    condition     = aws_iam_role.deploy.name == "GithubDeployRole" && aws_iam_openid_connect_provider.github.url == "https://token.actions.githubusercontent.com"
    error_message = "deploy.yml assumes role/GithubDeployRole, through GitHub's OIDC provider."
  }

  assert {
    condition     = aws_iam_openid_connect_provider.github.client_id_list == toset(["sts.amazonaws.com"])
    error_message = "The provider must accept the STS audience only."
  }

  # --- The policy's shape ---

  assert {
    condition = [for s in jsondecode(aws_iam_role_policy.deploy.policy).Statement : s.Sid] == [
      "WorkloadState", "WorkloadStateLock", "StateBucketList", "StateEncryption",
      "Functions", "FunctionLogs", "ListLogGroups", "Tables", "Buckets", "Parameters", "ListParameters", "GoogleClientSecret",
      "UserPools", "Api", "Cdn", "KnowledgeBases",
      "DnsRead", "DnsRecords", "CertificateRead",
      "WorkloadRoles", "PassWorkloadRoles", "ApiGatewayServiceRole",
      "DenyChangingCiAccess", "DenyRolesWithoutBoundary", "DenyRemovingBoundary", "DenyBudgets", "DenyKillSwitchWrites",
      "DenyHostedZones", "DenyOtherState", "DenyStateBucketChanges", "DenyTableData", "DenyDocuments", "DenyUserAccounts",
      "DenyLogReads", "DenyModelCalls",
    ]
    error_message = "A statement was added, removed, or reordered. Update this test only after reviewing the change to CI's access."
  }

  assert {
    # IAM's limit for all inline policies on a role, not counting whitespace. jsonencode adds none.
    condition     = length(aws_iam_role_policy.deploy.policy) < 10240
    error_message = "The deploy policy is over IAM's 10,240-character limit for inline policies."
  }

  assert {
    condition = alltrue([
      for s in jsondecode(aws_iam_role_policy.deploy.policy).Statement :
      !contains(flatten([s.Action]), "*") && !contains(flatten([s.Action]), "iam:*") if s.Effect == "Allow"
    ])
    error_message = "No allow may grant every action, or every IAM action."
  }

  # --- Allows ---

  assert {
    condition = [for s in jsondecode(aws_iam_role_policy.deploy.policy).Statement : s.Resource if contains(["WorkloadState", "WorkloadStateLock"], s.Sid)] == [
      "arn:aws:s3:::cv-tailor-tfstate-111111111111/dev/workload.tfstate",
      "arn:aws:s3:::cv-tailor-tfstate-111111111111/dev/workload.tfstate.tflock",
    ]
    error_message = "CI may read and write only the dev workload state and its lock file."
  }

  assert {
    condition     = one([for s in jsondecode(aws_iam_role_policy.deploy.policy).Statement : s.Resource if s.Sid == "StateEncryption"]) == "arn:aws:kms:us-east-1:111111111111:key/state"
    error_message = "CI may use the state key only."
  }

  assert {
    condition = { for s in jsondecode(aws_iam_role_policy.deploy.policy).Statement : s.Sid => s.Resource if contains(["Functions", "FunctionLogs", "Tables", "Buckets", "Parameters"], s.Sid) } == {
      Functions    = "arn:aws:lambda:us-east-1:111111111111:function:cv-tailor-dev-*"
      FunctionLogs = ["arn:aws:logs:us-east-1:111111111111:log-group:/aws/lambda/cv-tailor-dev-*", "arn:aws:logs:us-east-1:111111111111:log-group:/aws/lambda/cv-tailor-dev-*:*"]
      Tables       = ["arn:aws:dynamodb:us-east-1:111111111111:table/cv-tailor-dev-*", "arn:aws:dynamodb:us-east-1:111111111111:table/cv-tailor-dev-*/index/*"]
      Buckets      = ["arn:aws:s3:::cv-tailor-dev-*", "arn:aws:s3:::cv-tailor-dev-*/*"]
      Parameters   = "arn:aws:ssm:us-east-1:111111111111:parameter/cv-tailor/*"
    }
    error_message = "Service-wide allows must be limited to this environment's names."
  }

  assert {
    condition     = one([for s in jsondecode(aws_iam_role_policy.deploy.policy).Statement : s.Action if s.Sid == "Buckets"]) == ["s3:CreateBucket", "s3:DeleteBucket", "s3:DeleteBucketPolicy", "s3:DeleteObject", "s3:Get*", "s3:List*", "s3:Put*"]
    error_message = "CI's bucket actions must stay narrower than s3:*."
  }

  assert {
    condition = one([for s in jsondecode(aws_iam_role_policy.deploy.policy).Statement : s if s.Sid == "DnsRecords"]).Condition == {
      "ForAllValues:StringEquals" = {
        "route53:ChangeResourceRecordSetsNormalizedRecordNames" = ["dev.cv.ikiwii.com", "api.dev.cv.ikiwii.com", "auth.dev.cv.ikiwii.com"]
      }
    }
    error_message = "CI may change only the web app, API, and sign-in records."
  }

  assert {
    condition     = one([for s in jsondecode(aws_iam_role_policy.deploy.policy).Statement : s.Action if s.Sid == "CertificateRead"]) == ["acm:DescribeCertificate", "acm:GetCertificate", "acm:ListCertificates", "acm:ListTagsForCertificate"]
    error_message = "CI may only read certificates. The workload's certificate lookup needs GetCertificate, which returns no private key."
  }

  assert {
    condition     = one([for s in jsondecode(aws_iam_role_policy.deploy.policy).Statement : s.Resource if s.Sid == "GoogleClientSecret"]) == "arn:aws:secretsmanager:us-east-1:111111111111:secret:cv-tailor/google-client-secret-*"
    error_message = "CI may read the Google client secret only."
  }

  assert {
    condition = one([for s in jsondecode(aws_iam_role_policy.deploy.policy).Statement : s if s.Sid == "PassWorkloadRoles"]) == {
      Sid       = "PassWorkloadRoles"
      Effect    = "Allow"
      Action    = "iam:PassRole"
      Resource  = "arn:aws:iam::111111111111:role/cv-tailor/workload/*"
      Condition = { StringEquals = { "iam:PassedToService" = ["bedrock.amazonaws.com", "lambda.amazonaws.com"] } }
    }
    error_message = "CI may pass only workload roles, and only to Lambda and Bedrock."
  }

  assert {
    condition     = one([for s in jsondecode(aws_iam_role_policy.deploy.policy).Statement : s.Resource if s.Sid == "WorkloadRoles"]) == "arn:aws:iam::111111111111:role/cv-tailor/workload/*"
    error_message = "CI may manage roles under /cv-tailor/workload/ only."
  }

  # --- Denies ---

  assert {
    condition = one([for s in jsondecode(aws_iam_role_policy.deploy.policy).Statement : s.Resource if s.Sid == "DenyChangingCiAccess"]) == [
      "arn:aws:iam::111111111111:role/GithubDeployRole",
      "arn:aws:iam::111111111111:policy/cv-tailor/CvTailorWorkloadBoundary",
      "arn:aws:iam::111111111111:oidc-provider/token.actions.githubusercontent.com",
    ]
    error_message = "CI must not change its own role, the boundary, or the OIDC provider."
  }

  assert {
    condition = one([for s in jsondecode(aws_iam_role_policy.deploy.policy).Statement : s if s.Sid == "DenyRolesWithoutBoundary"]) == {
      Sid       = "DenyRolesWithoutBoundary"
      Effect    = "Deny"
      Action    = ["iam:CreateRole", "iam:PutRolePermissionsBoundary"]
      Resource  = "*"
      Condition = { StringNotEquals = { "iam:PermissionsBoundary" = "arn:aws:iam::111111111111:policy/cv-tailor/CvTailorWorkloadBoundary" } }
    }
    error_message = "Every role CI creates must carry the workload boundary."
  }

  assert {
    condition = { for s in jsondecode(aws_iam_role_policy.deploy.policy).Statement : s.Sid => [s.Effect, s.Action, s.Resource] if contains(["DenyRemovingBoundary", "DenyBudgets", "DenyKillSwitchWrites", "DenyHostedZones"], s.Sid) } == {
      DenyRemovingBoundary = ["Deny", "iam:DeleteRolePermissionsBoundary", "*"]
      DenyBudgets          = ["Deny", "budgets:*", "*"]
      DenyKillSwitchWrites = ["Deny", ["ssm:DeleteParameter", "ssm:DeleteParameters", "ssm:LabelParameterVersion", "ssm:PutParameter"], "arn:aws:ssm:us-east-1:111111111111:parameter/cv-tailor/ai-calls"]
      DenyHostedZones      = ["Deny", ["route53:CreateHostedZone", "route53:DeleteHostedZone", "route53domains:*"], "*"]
    }
    error_message = "CI must not remove a boundary, or change the budget, the kill switch, or hosted zones."
  }

  assert {
    condition = one([for s in jsondecode(aws_iam_role_policy.deploy.policy).Statement : s.Resource if s.Sid == "DenyOtherState"]) == [
      "arn:aws:s3:::cv-tailor-tfstate-111111111111/dev/bootstrap.tfstate*",
      "arn:aws:s3:::cv-tailor-tfstate-111111111111/dev/access.tfstate*",
      "arn:aws:s3:::cv-tailor-tfstate-111111111111/dev/baseline.tfstate*",
      "arn:aws:s3:::cv-tailor-tfstate-111111111111/dev/dns.tfstate*",
    ]
    error_message = "CI must not touch the state of the stacks applied from a laptop."
  }

  assert {
    condition = { for s in jsondecode(aws_iam_role_policy.deploy.policy).Statement : s.Sid => s.Resource if contains(["DenyTableData", "DenyDocuments"], s.Sid) } == {
      DenyTableData = ["arn:aws:dynamodb:us-east-1:111111111111:table/cv-tailor-dev-*", "arn:aws:dynamodb:us-east-1:111111111111:table/cv-tailor-dev-*/index/*"]
      DenyDocuments = "arn:aws:s3:::cv-tailor-dev-documents-111111111111/*"
    }
    error_message = "CI must not read or change users' table items or documents."
  }

  assert {
    condition     = alltrue([for action in ["dynamodb:GetItem", "dynamodb:Query", "dynamodb:Scan", "dynamodb:PutItem"] : contains(one([for s in jsondecode(aws_iam_role_policy.deploy.policy).Statement : s.Action if s.Sid == "DenyTableData"]), action)])
    error_message = "The table data deny must cover reads and writes."
  }

  # --- The permissions boundary ---

  assert {
    condition     = aws_iam_policy.workload_boundary.name == "CvTailorWorkloadBoundary" && aws_iam_policy.workload_boundary.path == "/cv-tailor/"
    error_message = "The boundary's name and path must match the ARN the deploy role's conditions name."
  }

  assert {
    condition = { for s in jsondecode(aws_iam_policy.workload_boundary.policy).Statement : s.Sid => [s.Effect, s.Action, s.Resource] } == {
      FunctionLogs = ["Allow", ["logs:CreateLogStream", "logs:PutLogEvents"], "arn:aws:logs:us-east-1:111111111111:log-group:/aws/lambda/cv-tailor-dev-*:*"]
      TableData = ["Allow", [
        "dynamodb:BatchGetItem", "dynamodb:BatchWriteItem", "dynamodb:ConditionCheckItem", "dynamodb:DeleteItem",
        "dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:Query", "dynamodb:UpdateItem",
      ], ["arn:aws:dynamodb:us-east-1:111111111111:table/cv-tailor-dev-*", "arn:aws:dynamodb:us-east-1:111111111111:table/cv-tailor-dev-*/index/*"]]
      BucketObjects = ["Allow", ["s3:DeleteObject", "s3:GetObject", "s3:ListBucket", "s3:PutObject"], ["arn:aws:s3:::cv-tailor-dev-*", "arn:aws:s3:::cv-tailor-dev-*/*"]]
      UserLinking = ["Allow", [
        "cognito-idp:AdminCreateUser", "cognito-idp:AdminDeleteUser", "cognito-idp:AdminLinkProviderForUser",
        "cognito-idp:AdminSetUserPassword", "cognito-idp:ListUsers",
      ], "arn:aws:cognito-idp:us-east-1:111111111111:userpool/*"]
      Parameters = ["Allow", ["ssm:GetParameter", "ssm:GetParameters"], "arn:aws:ssm:us-east-1:111111111111:parameter/cv-tailor/*"]
    }
    error_message = "The boundary changed. Widen it only for a reviewed new kind of workload role."
  }

  assert {
    condition     = length(aws_iam_policy.workload_boundary.policy) < 6144
    error_message = "The boundary is over IAM's 6,144-character limit for managed policies."
  }
}

run "refuses_a_wildcard_subject" {
  command = plan

  module {
    source = "../../modules/oidc"
  }

  variables {
    region                    = "us-east-1"
    host                      = "dev.cv.ikiwii.com"
    github_subject            = "repo:dhnhut/cv-tailor:*"
    state_key_arn             = "arn:aws:kms:us-east-1:111111111111:key/state"
    google_client_secret_name = "cv-tailor/google-client-secret"
    workload_iam = {
      role_path     = "/cv-tailor/workload/"
      boundary_name = "CvTailorWorkloadBoundary"
      boundary_path = "/cv-tailor/"
    }
  }

  expect_failures = [var.github_subject]
}
