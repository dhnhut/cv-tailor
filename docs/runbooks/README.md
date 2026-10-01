# Runbooks

Step-by-step procedures for operating CV Tailor's AWS accounts and deployments. They record the setup that was done by hand in Sprint 1 ([ADR-0004](../adr/0004-accounts-and-access.md)) and how to run, recover, and stop it.

| Runbook                                       | Use it when                                                                                            | Related            |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------ |
| [Account access](account-access.md)           | Signing in to AWS, setting up a new machine, giving access to a new account, or SSO stops working.     | ADR-0004 §3        |
| [Deploy and rollback](deploy-and-rollback.md) | Deploying, previewing a change, setting up a new account, recovering a failed deploy, or rolling back. | ADR-0004 §4–5, §10 |
| [Budget alarm response](budget-alarm.md)      | A budget alert email arrives, or spend looks wrong.                                                    | `AGENTS.md` §8     |
| [Kill switch](kill-switch.md)                 | Placeholder. The feature doesn't exist yet.                                                            | ADMIN-03           |

The Organization guardrails (SCPs and the organization CloudTrail trail) are applied with the commands in [`infra/org/README.md`](../../infra/org/README.md), not repeated here.

## Conventions

- Every runbook has the same sections: **When to use**, **Before you start**, the steps, **Verify**, and **If it fails**.
- Commands run from the repository root, in bash.
- Commands never contain account IDs, because the repository is public (ADR-0004 §2). IDs are looked up when the command runs, from the account name in the Organization or from the profile:

  ```bash
  aws sts get-caller-identity --profile cvt-dev --query Account --output text
  ```

- Every command names its profile with `--profile`. For `prod`, use `cvt-prod-ro` unless the step needs to change something.

## Later

- Kill switch (ADMIN-03), when the feature is built.
- Investigating agent failures, when the first agent is deployed.
