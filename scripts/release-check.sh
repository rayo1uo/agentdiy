#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "[1/2] Build extension"
npm --prefix "${ROOT_DIR}/extension" run build

echo "[2/2] Run backend tests"
(
  cd "${ROOT_DIR}/server"
  go test ./...
)

echo "Release checks passed."
