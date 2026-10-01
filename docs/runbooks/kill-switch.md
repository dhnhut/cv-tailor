# Kill Switch

> **Placeholder.** The kill switch (ADMIN-03) is not built yet. This runbook is written with the feature.

## What it will do

ADMIN-03: an admin turns off every AI call in the app at once. The app keeps running, and users see that AI features are paused.

## How it differs from the emergency deny SCP

|              | Kill switch (ADMIN-03, later) | `EmergencyDeny` SCP (now)                                    |
| ------------ | ----------------------------- | ------------------------------------------------------------ |
| Scope        | AI calls inside the app       | Every action in one AWS account, except the human SSO roles  |
| Who uses it  | An admin, from the app        | The owner, from the management account                       |
| App behavior | Keeps running without AI      | Stops entirely, and CI deploys fail                          |
| Use it when  | AI cost or abuse              | Unknown spend, leaked credentials, or the kill switch failed |

## Until it exists

Use the [emergency stop in the budget alarm runbook](budget-alarm.md#5-emergency-stop).
