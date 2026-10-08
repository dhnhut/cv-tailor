# Kill Switch

How to turn every AI call in one environment off and on again (ADMIN-03), check the switch's state, and see who changed it. The design is in the [Sprint 2 doc](../sprints/sprint-02-walking-skeleton.md#s2-11-details-the-ai-call-guard), S2-11.

The switch is the SSM parameter `/cv-tailor/ai-calls` in each environment's account. The baseline stack creates it ([`infra/modules/kill-switch`](../../infra/modules/kill-switch/main.tf)). Every AI call in `services/agents` goes through the AI call guard (`cv_tailor_agents.ai_guard`), and the guard reads the switch before each call:

| Value                                 | Effect                                                     |
| ------------------------------------- | ---------------------------------------------------------- |
| `enabled`                             | AI calls are allowed, within the per-call caps (QUOTA-04). |
| `disabled`                            | Every AI call is refused before it reaches Bedrock.        |
| Missing, unreadable, or anything else | Every AI call is refused too. The guard fails closed.      |

- **Timing:** the guard caches the value for 30 seconds, so a change takes effect within 30 seconds.
- **Typos:** SSM accepts only `enabled` and `disabled` (`AllowedPattern`), so a typo fails at `put-parameter`.
- **Starting value:** each environment starts with its value in `ai_calls_initial` in [`infra/modules/settings`](../../infra/modules/settings/main.tf). That's `enabled` in `dev`, and `disabled` in `stag` and `prod` until their first release.
- **Coverage today:** model calls from `services/agents`. Knowledge base Retrieve calls, the API's own check, and the message users see come with Sprint 3.

## How it differs from the emergency deny SCP

|               | Kill switch (ADMIN-03)                                               | `EmergencyDeny` SCP                                          |
| ------------- | -------------------------------------------------------------------- | ------------------------------------------------------------ |
| Scope         | AI calls made through the guard                                      | Every action in one AWS account, except the human SSO roles  |
| Who uses it   | The owner, with the AWS CLI. An admin screen comes later (ADMIN-01). | The owner, from the management account                       |
| App behaviour | Keeps running, with AI features paused                               | Stops entirely, and CI deploys fail                          |
| Takes effect  | Within 30 seconds                                                    | A few minutes                                                |
| Use it when   | AI cost or abuse                                                     | Unknown spend, leaked credentials, or the kill switch failed |

## When to use

- AI spend is higher than expected, or a budget alert points at Bedrock ([budget alarm runbook](budget-alarm.md)).
- Someone is abusing the AI features, or an agent is stuck in a loop.
- Turning AI calls on in an environment at its first release.
- Checking the switch's state or its history.

## Before you start

1. Sign in: `aws sso login --sso-session org` ([account access](account-access.md)).
2. Set the environment: `ENV=dev`.
3. Reading works with any profile. Changing the switch needs `cvt-$ENV`. For `prod`, read with `cvt-prod-ro` and change with `cvt-prod`.

## 1. Check the switch

```bash
aws ssm get-parameter --name /cv-tailor/ai-calls --profile "cvt-$ENV" \
  --query Parameter.Value --output text
```

It prints `enabled` or `disabled`. `ParameterNotFound` means the baseline stack isn't applied in this account, and every AI call is refused.

## 2. Turn AI calls off

```bash
aws ssm put-parameter --name /cv-tailor/ai-calls --value disabled --overwrite --profile "cvt-$ENV"
```

Wait 30 seconds. A model call already in progress finishes. The guard checks before each call, so a generation with several steps stops at its next model call.

## 3. Turn AI calls back on

Fix the cause first. Then:

```bash
aws ssm put-parameter --name /cv-tailor/ai-calls --value enabled --overwrite --profile "cvt-$ENV"
```

## 4. See who changed it, and when

```bash
aws ssm get-parameter-history --name /cv-tailor/ai-calls --profile "cvt-$ENV" \
  --query 'Parameters[].[LastModifiedDate,LastModifiedUser,Value]' --output table
```

- The first version was written by OpenTofu, as the SSO role that applied the baseline stack. Later versions show the SSO role and session of the person who changed the switch. The history starts at the move to OpenTofu (S3-15): the parameter was created again then, and SSM deletes a parameter's history with it.
- SSM keeps the last 100 versions, and CloudTrail records each `PutParameter`.

## 5. Apply the baseline stack without resetting the switch

OpenTofu writes the committed initial value (`ai_calls_initial` in [`infra/modules/settings`](../../infra/modules/settings/main.tf)) only when it creates the parameter. After that it ignores the value (`ignore_changes`), so an apply that changes the budget, or the parameter's description, leaves the switch alone.

The one exception is a change that replaces the parameter, such as a new name. To apply safely:

1. Note the current value (step 1).
2. Preview the apply ([deploy runbook, step 3](deploy-and-rollback.md#3-laptop-only-stacks-access-baseline-and-dns)):

   ```bash
   infra/scripts/tofu.sh "$ENV" baseline plan
   ```

   If the plan replaces `module.kill_switch.aws_ssm_parameter.ai_calls` (`-/+`), this apply will write the initial value.

3. After the apply, check the value again. If it changed, set it back with step 2 or step 3.

## Verify

1. Step 1 prints the value you set.
2. Run the live check from `services/agents`. While the switch is `enabled`, each line makes a tiny Bedrock call that costs a fraction of a cent.

   ```bash
   cd services/agents
   AWS_PROFILE="cvt-$ENV" uv run python scripts/ai_guard_check.py --minutes 1
   ```

   - With `disabled`: within 30 seconds, every line shows `blocked AiCallsDisabled`.
   - With `enabled`: lines show `allowed`.

## If it fails

| Symptom                                                   | Cause and fix                                                                                                                                                                                                 |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `InvalidAllowedPatternException`                          | The value isn't `enabled` or `disabled`. Use lowercase, with no spaces.                                                                                                                                       |
| `ParameterNotFound`                                       | The baseline stack isn't applied in this account. Apply it ([deploy runbook, step 3](deploy-and-rollback.md#3-laptop-only-stacks-access-baseline-and-dns)). Until then, every AI call is refused.             |
| `AccessDeniedException` on `put-parameter`                | You used a read-only profile. Use `cvt-$ENV`. The SSO admin role can still change the switch while `EmergencyDeny` is attached.                                                                               |
| Calls still allowed more than 30 seconds after `disabled` | Check the value (step 1) and that you're in the right environment. If calls still get through, they aren't going through the guard. That's a bug: use the [emergency stop](budget-alarm.md#5-emergency-stop). |
| Calls still refused after `enabled`                       | The guard can't read the parameter: the agent's role lacks `ssm:GetParameter` on it, or SSM is failing. Look for `Kill switch unreadable` warnings in the agent's logs.                                       |
| The switch changed without anyone setting it              | A baseline apply replaced the parameter and wrote the initial value (step 5). Check the history (step 4).                                                                                                     |
