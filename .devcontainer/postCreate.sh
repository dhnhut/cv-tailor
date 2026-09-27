#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

echo "==> Enabling corepack and activating pnpm 12.5.1"
corepack enable
corepack prepare pnpm@12.5.1 --activate

echo "==> Installing uv"
curl -LsSf https://astral.sh/uv/install.sh | sh

echo "==> Tool versions"
node -v
pnpm -v
python3 --version
"$HOME/.local/bin/uv" --version
aws --version
docker --version

if [ -f pnpm-workspace.yaml ]; then
  echo "==> Installing JS/TS workspace dependencies"
  pnpm install
fi

if [ -f services/agents/pyproject.toml ]; then
  echo "==> Syncing Python agent service dependencies"
  (cd services/agents && "$HOME/.local/bin/uv" sync)
fi

echo "==> Dev container ready"
