# GitHub OIDC access for one account (S1-07, ADR-0004 §4, ADR-0013 §5): the OIDC provider,
# GithubDeployRole, and the permissions boundary that every workload role must carry. It's in the
# access stack, which is applied from a laptop only, so CI can never change the role it signs in with.
#
# Since S3-15 the role calls AWS itself (no CloudFormation role in between). Three things keep it
# inside the workload:
#   1. Its allows name this environment's resources (cv-tailor-<env>-*, /cv-tailor/*) wherever the
#      service supports it.
#   2. Every role it creates must carry the permissions boundary, which caps what any workload role
#      can ever do. It can't create a role without it, or remove it.
#   3. Explicit denies protect CI's own access, the budget, the kill switch, the hosted zones, the
#      other stacks' state, and user data.
# Every ARN is built from names, not read from resources, so `tofu plan` shows each policy in full.

locals {
  oidc_host     = "token.actions.githubusercontent.com"
  sts_audience  = "sts.amazonaws.com"
  oidc_provider = "arn:aws:iam::${var.account_id}:oidc-provider/${local.oidc_host}"
  deploy_role   = "arn:aws:iam::${var.account_id}:role/GithubDeployRole"

  boundary_arn   = "arn:aws:iam::${var.account_id}:policy${var.workload_iam.boundary_path}${var.workload_iam.boundary_name}"
  workload_roles = "arn:aws:iam::${var.account_id}:role${var.workload_iam.role_path}*"

  # Only this environment's workload state. The other stacks are applied from a laptop.
  state_bucket = "arn:aws:s3:::cv-tailor-tfstate-${var.account_id}"
  state_file   = "${local.state_bucket}/${var.environment}/workload.tfstate"
  other_state  = [for stack in ["bootstrap", "access", "baseline", "dns"] : "${local.state_bucket}/${var.environment}/${stack}.tfstate*"]

  prefix           = "cv-tailor-${var.environment}"
  functions        = "arn:aws:lambda:${var.region}:${var.account_id}:function:${local.prefix}-*"
  log_groups       = "arn:aws:logs:${var.region}:${var.account_id}:log-group:/aws/lambda/${local.prefix}-*"
  tables           = "arn:aws:dynamodb:${var.region}:${var.account_id}:table/${local.prefix}-*"
  buckets          = "arn:aws:s3:::${local.prefix}-*"
  documents_bucket = "arn:aws:s3:::${local.prefix}-documents-${var.account_id}"
  parameters       = "arn:aws:ssm:${var.region}:${var.account_id}:parameter/cv-tailor/*"
  kill_switch      = "arn:aws:ssm:${var.region}:${var.account_id}:parameter/cv-tailor/ai-calls"
  user_pools       = "arn:aws:cognito-idp:${var.region}:${var.account_id}:userpool/*"
  google_secret    = "arn:aws:secretsmanager:${var.region}:${var.account_id}:secret:${var.google_client_secret_name}-*"

  # The only records CI may change: the web app, the API, and the sign-in pages. Route 53 compares
  # lowercase names without the trailing dot.
  record_names = [var.host, "api.${var.host}", "auth.${var.host}"]

  # The data actions CI never needs: reading or changing users' items, documents, accounts, or logs,
  # and calling models.
  table_data_actions = [
    "dynamodb:BatchGetItem",
    "dynamodb:BatchWriteItem",
    "dynamodb:DeleteItem",
    "dynamodb:ExportTableToPointInTime",
    "dynamodb:GetItem",
    "dynamodb:PartiQLDelete",
    "dynamodb:PartiQLInsert",
    "dynamodb:PartiQLSelect",
    "dynamodb:PartiQLUpdate",
    "dynamodb:PutItem",
    "dynamodb:Query",
    "dynamodb:Scan",
    "dynamodb:UpdateItem",
  ]
}

resource "aws_iam_openid_connect_provider" "github" {
  url            = "https://${local.oidc_host}"
  client_id_list = [local.sts_audience]

  lifecycle {
    prevent_destroy = true # every CI deploy depends on it
  }
}

resource "aws_iam_role" "deploy" {
  name                 = "GithubDeployRole"
  description          = "CI deploys of the ${var.environment} workload stack (ADR-0013 section 5)"
  max_session_duration = 3600

  # Trust: only this repository, only in this environment's GitHub Environment, in GitHub's
  # immutable subject format (ADR-0004 §4).
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Federated = local.oidc_provider }
      Action    = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = {
          "${local.oidc_host}:aud" = local.sts_audience
          "${local.oidc_host}:sub" = var.github_subject
        }
      }
    }]
  })

  depends_on = [aws_iam_openid_connect_provider.github]

  lifecycle {
    prevent_destroy = true # every CI deploy depends on it
  }
}

resource "aws_iam_role_policy" "deploy" {
  name = "DeployWorkload"
  role = aws_iam_role.deploy.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      # --- OpenTofu state: this environment's workload state only ---
      {
        Sid      = "WorkloadState"
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:PutObject"]
        Resource = local.state_file
      },
      {
        Sid      = "WorkloadStateLock"
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
        Resource = "${local.state_file}.tflock"
      },
      {
        Sid      = "StateBucketList"
        Effect   = "Allow"
        Action   = "s3:ListBucket"
        Resource = local.state_bucket
      },
      {
        Sid      = "StateEncryption"
        Effect   = "Allow"
        Action   = ["kms:Decrypt", "kms:GenerateDataKey"]
        Resource = var.state_key_arn
      },

      # --- The workload's resources, by this environment's names ---
      {
        Sid      = "Functions"
        Effect   = "Allow"
        Action   = "lambda:*"
        Resource = local.functions
      },
      {
        Sid      = "FunctionLogs"
        Effect   = "Allow"
        Action   = "logs:*"
        Resource = [local.log_groups, "${local.log_groups}:*"]
      },
      {
        # DescribeLogGroups is authorized against every log group in the account.
        Sid      = "ListLogGroups"
        Effect   = "Allow"
        Action   = "logs:DescribeLogGroups"
        Resource = "arn:aws:logs:${var.region}:${var.account_id}:log-group:*"
      },
      {
        Sid      = "Tables"
        Effect   = "Allow"
        Action   = "dynamodb:*"
        Resource = [local.tables, "${local.tables}/index/*"]
      },
      {
        # Bucket settings, and the web app's files (deploy-web.sh). Not s3:*, which would add
        # actions such as Object Lock bypass and replication that CI never needs.
        Sid      = "Buckets"
        Effect   = "Allow"
        Action   = ["s3:CreateBucket", "s3:DeleteBucket", "s3:DeleteBucketPolicy", "s3:DeleteObject", "s3:Get*", "s3:List*", "s3:Put*"]
        Resource = [local.buckets, "${local.buckets}/*"]
      },
      {
        Sid      = "Parameters"
        Effect   = "Allow"
        Action   = ["ssm:AddTagsToResource", "ssm:DeleteParameter", "ssm:GetParameter", "ssm:GetParameters", "ssm:ListTagsForResource", "ssm:PutParameter", "ssm:RemoveTagsFromResource"]
        Resource = local.parameters
      },
      {
        Sid      = "ListParameters"
        Effect   = "Allow"
        Action   = "ssm:DescribeParameters"
        Resource = "*"
      },
      {
        Sid      = "GoogleClientSecret"
        Effect   = "Allow"
        Action   = ["secretsmanager:DescribeSecret", "secretsmanager:GetSecretValue"]
        Resource = local.google_secret
      },

      # --- Services whose resources have generated IDs, not names. The account holds only this
      # environment, and the denies below keep user data out of reach. ---
      {
        Sid      = "UserPools"
        Effect   = "Allow"
        Action   = "cognito-idp:*"
        Resource = "*"
      },
      {
        Sid      = "Api"
        Effect   = "Allow"
        Action   = "apigateway:*"
        Resource = "arn:aws:apigateway:${var.region}::/*"
      },
      {
        Sid      = "Cdn"
        Effect   = "Allow"
        Action   = "cloudfront:*"
        Resource = "*"
      },
      {
        Sid    = "KnowledgeBases"
        Effect = "Allow"
        Action = [
          "bedrock:CreateDataSource",
          "bedrock:CreateKnowledgeBase",
          "bedrock:DeleteDataSource",
          "bedrock:DeleteKnowledgeBase",
          "bedrock:GetDataSource",
          "bedrock:GetKnowledgeBase",
          "bedrock:ListDataSources",
          "bedrock:ListKnowledgeBases",
          "bedrock:ListTagsForResource",
          "bedrock:TagResource",
          "bedrock:UntagResource",
          "bedrock:UpdateDataSource",
          "bedrock:UpdateKnowledgeBase",
        ]
        Resource = "*"
      },

      # --- DNS and certificates: read, plus the workload's own records ---
      {
        Sid      = "DnsRead"
        Effect   = "Allow"
        Action   = ["route53:GetChange", "route53:GetHostedZone", "route53:ListHostedZones", "route53:ListHostedZonesByName", "route53:ListResourceRecordSets", "route53:ListTagsForResource"]
        Resource = "*"
      },
      {
        Sid       = "DnsRecords"
        Effect    = "Allow"
        Action    = "route53:ChangeResourceRecordSets"
        Resource  = "arn:aws:route53:::hostedzone/*"
        Condition = { "ForAllValues:StringEquals" = { "route53:ChangeResourceRecordSetsNormalizedRecordNames" = local.record_names } }
      },
      {
        Sid      = "CertificateRead"
        Effect   = "Allow"
        Action   = ["acm:DescribeCertificate", "acm:ListCertificates", "acm:ListTagsForCertificate"]
        Resource = "*"
      },

      # --- Workload roles: under one path, always with the boundary ---
      {
        Sid    = "WorkloadRoles"
        Effect = "Allow"
        Action = [
          "iam:CreateRole",
          "iam:DeleteRole",
          "iam:DeleteRolePolicy",
          "iam:GetRole",
          "iam:GetRolePolicy",
          "iam:ListAttachedRolePolicies",
          "iam:ListInstanceProfilesForRole",
          "iam:ListRolePolicies",
          "iam:ListRoleTags",
          "iam:PutRolePermissionsBoundary",
          "iam:PutRolePolicy",
          "iam:TagRole",
          "iam:UntagRole",
          "iam:UpdateAssumeRolePolicy",
          "iam:UpdateRole",
          "iam:UpdateRoleDescription",
        ]
        Resource = local.workload_roles
      },
      {
        Sid       = "PassWorkloadRoles"
        Effect    = "Allow"
        Action    = "iam:PassRole"
        Resource  = local.workload_roles
        Condition = { StringEquals = { "iam:PassedToService" = ["bedrock.amazonaws.com", "lambda.amazonaws.com"] } }
      },
      {
        # API Gateway creates this role the first time an account gets a custom domain.
        Sid       = "ApiGatewayServiceRole"
        Effect    = "Allow"
        Action    = "iam:CreateServiceLinkedRole"
        Resource  = "arn:aws:iam::${var.account_id}:role/aws-service-role/ops.apigateway.amazonaws.com/*"
        Condition = { StringEquals = { "iam:AWSServiceName" = "ops.apigateway.amazonaws.com" } }
      },

      # --- Explicit denies: they win over every allow above ---
      {
        Sid      = "DenyChangingCiAccess"
        Effect   = "Deny"
        Action   = "iam:*"
        Resource = [local.deploy_role, local.boundary_arn, local.oidc_provider]
      },
      {
        # A role created or changed without the boundary is refused. With StringNotEquals, a
        # request that names no boundary is refused too.
        Sid       = "DenyRolesWithoutBoundary"
        Effect    = "Deny"
        Action    = ["iam:CreateRole", "iam:PutRolePermissionsBoundary"]
        Resource  = "*"
        Condition = { StringNotEquals = { "iam:PermissionsBoundary" = local.boundary_arn } }
      },
      {
        Sid      = "DenyRemovingBoundary"
        Effect   = "Deny"
        Action   = "iam:DeleteRolePermissionsBoundary"
        Resource = "*"
      },
      {
        Sid      = "DenyBudgets"
        Effect   = "Deny"
        Action   = "budgets:*"
        Resource = "*"
      },
      {
        Sid      = "DenyKillSwitchWrites"
        Effect   = "Deny"
        Action   = ["ssm:DeleteParameter", "ssm:DeleteParameters", "ssm:LabelParameterVersion", "ssm:PutParameter"]
        Resource = local.kill_switch
      },
      {
        Sid      = "DenyHostedZones"
        Effect   = "Deny"
        Action   = ["route53:CreateHostedZone", "route53:DeleteHostedZone", "route53domains:*"]
        Resource = "*"
      },
      {
        Sid      = "DenyOtherState"
        Effect   = "Deny"
        Action   = ["s3:DeleteObject*", "s3:GetObject*", "s3:PutObject*"]
        Resource = local.other_state
      },
      {
        Sid    = "DenyStateBucketChanges"
        Effect = "Deny"
        Action = [
          "s3:DeleteBucket",
          "s3:DeleteBucketPolicy",
          "s3:PutBucketPolicy",
          "s3:PutBucketPublicAccessBlock",
          "s3:PutBucketVersioning",
          "s3:PutEncryptionConfiguration",
          "s3:PutLifecycleConfiguration",
        ]
        Resource = local.state_bucket
      },
      {
        Sid      = "DenyTableData"
        Effect   = "Deny"
        Action   = local.table_data_actions
        Resource = [local.tables, "${local.tables}/index/*"]
      },
      {
        Sid      = "DenyDocuments"
        Effect   = "Deny"
        Action   = ["s3:DeleteObject*", "s3:GetObject*", "s3:PutObject*"]
        Resource = "${local.documents_bucket}/*"
      },
      {
        Sid      = "DenyUserAccounts"
        Effect   = "Deny"
        Action   = ["cognito-idp:Admin*", "cognito-idp:ListUsers", "cognito-idp:ListUsersInGroup"]
        Resource = "*"
      },
      {
        Sid      = "DenyLogReads"
        Effect   = "Deny"
        Action   = ["logs:FilterLogEvents", "logs:GetLogEvents", "logs:StartLiveTail", "logs:StartQuery"]
        Resource = "*"
      },
      {
        Sid      = "DenyModelCalls"
        Effect   = "Deny"
        Action   = ["bedrock:Converse*", "bedrock:CreateProvisionedModelThroughput", "bedrock:InvokeModel*", "bedrock:Retrieve*"]
        Resource = "*"
      },
    ]
  })
}

# The most any workload role can ever do, whatever its own policy says (ADR-0013 §5). A role for a
# new kind of work (for example the AgentCore Runtime in S3-10) widens this from a laptop first.
resource "aws_iam_policy" "workload_boundary" {
  name        = var.workload_iam.boundary_name
  path        = var.workload_iam.boundary_path
  description = "Permissions boundary for every ${var.environment} workload role (ADR-0013 section 5)"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "FunctionLogs"
        Effect   = "Allow"
        Action   = ["logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "${local.log_groups}:*"
      },
      {
        Sid    = "TableData"
        Effect = "Allow"
        Action = [
          "dynamodb:BatchGetItem",
          "dynamodb:BatchWriteItem",
          "dynamodb:ConditionCheckItem",
          "dynamodb:DeleteItem",
          "dynamodb:GetItem",
          "dynamodb:PutItem",
          "dynamodb:Query",
          "dynamodb:UpdateItem",
        ]
        Resource = [local.tables, "${local.tables}/index/*"]
      },
      {
        Sid      = "BucketObjects"
        Effect   = "Allow"
        Action   = ["s3:DeleteObject", "s3:GetObject", "s3:ListBucket", "s3:PutObject"]
        Resource = [local.buckets, "${local.buckets}/*"]
      },
      {
        # The pre sign-up trigger links Google sign-ins to local users (S2-07).
        Sid    = "UserLinking"
        Effect = "Allow"
        Action = [
          "cognito-idp:AdminCreateUser",
          "cognito-idp:AdminDeleteUser",
          "cognito-idp:AdminLinkProviderForUser",
          "cognito-idp:AdminSetUserPassword",
          "cognito-idp:ListUsers",
        ]
        Resource = local.user_pools
      },
      {
        Sid      = "Parameters"
        Effect   = "Allow"
        Action   = ["ssm:GetParameter", "ssm:GetParameters"]
        Resource = local.parameters
      },
    ]
  })

  lifecycle {
    prevent_destroy = true # every workload role refers to it
  }
}
