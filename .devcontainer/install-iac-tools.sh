#!/usr/bin/env bash
# Installs the infrastructure tools at pinned versions into ~/.local/bin (S3-15, ADR-0013):
# OpenTofu, TFLint, and Trivy. Each download is checked against a SHA-256 committed here, so a
# changed release file fails the install. CI installs the same versions (.github/workflows/ci.yml).
#
# To update a tool: change its version, then copy the new hashes from the release's checksum file:
#   OpenTofu: https://github.com/opentofu/opentofu/releases/download/v<version>/tofu_<version>_SHA256SUMS
#   TFLint:   https://github.com/terraform-linters/tflint/releases/download/v<version>/checksums.txt
#   Trivy:    https://github.com/aquasecurity/trivy/releases/download/v<version>/trivy_<version>_checksums.txt
set -euo pipefail

TOFU_VERSION=1.13.1
TFLINT_VERSION=0.64.0
TRIVY_VERSION=0.75.0

case "$(uname -m)" in
  x86_64)
    ARCH=amd64
    TRIVY_ARCH=64bit
    TOFU_SHA256=8ccbc6f8ee21d2827715f3c6e08a9b3e0209b1e62057c05067ef117e047c1a80
    TFLINT_SHA256=cca9d13e2e1d7a2c627af60ff899a3c9b74212899416aeb96ec764d2ef954537
    TRIVY_SHA256=c6e65abddb348e25f10549df887045629cf28cc72453cd1c63acb717316b3f3f
    ;;
  aarch64 | arm64)
    ARCH=arm64
    TRIVY_ARCH=ARM64
    TOFU_SHA256=b9614df40575cc3fc10a8a25025b7245d961da279f715ea3efff4ddae8e6938a
    TFLINT_SHA256=560da89aacf59389d4eb029730dd5b109b7288096c32f2726a0d9e783a5ea8eb
    TRIVY_SHA256=a1ee9f6ffb7d112b64ff726a2a0717c21175c1114361391f4a132956751a13b3
    ;;
  *)
    echo "Unsupported architecture: $(uname -m)" >&2
    exit 1
    ;;
esac

BIN_DIR="$HOME/.local/bin"
WORK_DIR=$(mktemp -d)
trap 'rm -rf "$WORK_DIR"' EXIT
mkdir -p "$BIN_DIR"

# fetch <url> <sha256> <file>: downloads and refuses a file whose hash doesn't match.
fetch() {
  curl -fsSL "$1" -o "$WORK_DIR/$3"
  echo "$2  $WORK_DIR/$3" | sha256sum --check --quiet
}

echo "==> OpenTofu $TOFU_VERSION"
fetch "https://github.com/opentofu/opentofu/releases/download/v$TOFU_VERSION/tofu_${TOFU_VERSION}_linux_$ARCH.zip" \
  "$TOFU_SHA256" tofu.zip
unzip -oq "$WORK_DIR/tofu.zip" tofu -d "$BIN_DIR"

echo "==> TFLint $TFLINT_VERSION"
fetch "https://github.com/terraform-linters/tflint/releases/download/v$TFLINT_VERSION/tflint_linux_$ARCH.zip" \
  "$TFLINT_SHA256" tflint.zip
unzip -oq "$WORK_DIR/tflint.zip" tflint -d "$BIN_DIR"

echo "==> Trivy $TRIVY_VERSION"
fetch "https://github.com/aquasecurity/trivy/releases/download/v$TRIVY_VERSION/trivy_${TRIVY_VERSION}_Linux-$TRIVY_ARCH.tar.gz" \
  "$TRIVY_SHA256" trivy.tar.gz
tar -xzf "$WORK_DIR/trivy.tar.gz" -C "$BIN_DIR" trivy

"$BIN_DIR/tofu" version
"$BIN_DIR/tflint" --version
"$BIN_DIR/trivy" --version
