#!/usr/bin/env bash
# Fails if the committed generated contract files are out of date.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

GENERATED=(packages/contracts/schemas services/agents/src/cv_tailor_agents/contracts infra/generated)

pnpm run generate

# Compare regenerated files with the staging area (what you're about to commit):
#   git diff        → files generate changed or deleted
#   git ls-files -o → new files generate created that git doesn't track yet

if ! git diff --quiet -- "${GENERATED[@]}" \
   || [ -n "$(git ls-files --others --exclude-standard -- "${GENERATED[@]}")" ]; then
  echo "❌ Generated contracts are out of date. Run 'pnpm run generate' and commit the result." >&2
  git status --short -- "${GENERATED[@]}" >&2
  git --no-pager diff -- "${GENERATED[@]}" >&2
  exit 1
fi
echo "✅ Generated contracts are up to date."
