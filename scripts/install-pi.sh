#!/usr/bin/env bash
# Build and install pi globally from the vendored fork.
#
# Strategy: pack all workspace packages as tarballs, rewrite coding-agent's
# deps to point at those tarballs, then npm install -g. This avoids any
# npm registry lookup for workspace packages.
#
# Version stamping:
#   A dev version is stamped into the installed package so `pi --version`
#   shows a build newer than the last npm release. Format:
#     <base>-cwilson613.<next_N>-dev.<YYYYMMDDHHMMSS>
#   The source package.json files are restored after packing.
#
# Usage:
#   ./scripts/install-pi.sh              # build + install
#   ./scripts/install-pi.sh --skip-build # install only (assumes dist/ is current)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PI_MONO="$ROOT_DIR/vendor/pi-mono"
CODING_AGENT="$PI_MONO/packages/coding-agent"
STAGING="/tmp/pi-install-staging-$$"

cleanup() {
  rm -rf "$STAGING"
  # Restore source package.json files
  (cd "$PI_MONO" && git checkout -- 'packages/*/package.json' package-lock.json 2>/dev/null || true)
}
trap cleanup EXIT

mkdir -p "$STAGING"

# ── Compute dev version ───────────────────────────────────────────────────
compute_dev_version() {
  local current_ver
  current_ver=$(node -p "require('$CODING_AGENT/package.json').version")
  local base_ver="${current_ver%%-cwilson613*}"

  local latest_n
  latest_n=$(cd "$PI_MONO" && git tag --list "v${base_ver}-cwilson613.*" 2>/dev/null \
    | sed "s/v${base_ver}-cwilson613\.//" \
    | grep -E '^[0-9]+$' \
    | sort -n | tail -1)
  latest_n="${latest_n:-0}"

  local next_n=$(( latest_n + 1 ))
  local timestamp
  timestamp=$(date +%Y%m%d%H%M%S)
  echo "${base_ver}-cwilson613.${next_n}-dev.${timestamp}"
}

DEV_VERSION=$(compute_dev_version)
echo "▸ Dev version: $DEV_VERSION"

# ── Stamp version into all packages ───────────────────────────────────────
for pkg_dir in "$PI_MONO"/packages/*/; do
  pj="${pkg_dir}package.json"
  [[ -f "$pj" ]] || continue
  node -e "
    const fs = require('fs');
    const pkg = JSON.parse(fs.readFileSync('$pj', 'utf8'));
    pkg.version = '$DEV_VERSION';
    fs.writeFileSync('$pj', JSON.stringify(pkg, null, '\t') + '\n');
  "
done

# Sync cross-package dep versions
[[ -f "$PI_MONO/scripts/sync-versions.js" ]] && \
  (cd "$PI_MONO" && node scripts/sync-versions.js 2>/dev/null || true)

# ── Build ─────────────────────────────────────────────────────────────────
if [[ "${1:-}" != "--skip-build" ]]; then
  echo "▸ Building pi-mono..."
  (cd "$PI_MONO" && npm run build)
else
  echo "▸ Skipping build (--skip-build)"
fi

# ── Pack workspace deps as tarballs ───────────────────────────────────────
echo "▸ Packing workspace packages..."
declare -A TARBALL_MAP

for pkg_name in pi-tui pi-ai pi-agent-core; do
  pkg_dir="$PI_MONO/packages/${pkg_name#pi-}"
  # Map package dir names: pi-tui→tui, pi-ai→ai, pi-agent-core→agent
  case "$pkg_name" in
    pi-tui)        pkg_dir="$PI_MONO/packages/tui" ;;
    pi-ai)         pkg_dir="$PI_MONO/packages/ai" ;;
    pi-agent-core) pkg_dir="$PI_MONO/packages/agent" ;;
  esac

  tarball=$(cd "$pkg_dir" && npm pack --pack-destination "$STAGING" 2>/dev/null | tail -1)
  full_name="@cwilson613/$pkg_name"
  TARBALL_MAP["$full_name"]="$STAGING/$tarball"
  echo "  ✓ $full_name → $tarball"
done

# ── Rewrite coding-agent deps to file: references ────────────────────────
echo "▸ Rewriting coding-agent deps to local tarballs..."
node -e "
  const fs = require('fs');
  const pkg = JSON.parse(fs.readFileSync('$CODING_AGENT/package.json', 'utf8'));
  const map = JSON.parse('$(
    printf '{'
    first=true
    for key in "${!TARBALL_MAP[@]}"; do
      $first || printf ','
      printf '"%s":"%s"' "$key" "${TARBALL_MAP[$key]}"
      first=false
    done
    printf '}'
  )');
  for (const [name, tarball] of Object.entries(map)) {
    if (pkg.dependencies?.[name]) pkg.dependencies[name] = 'file:' + tarball;
    if (pkg.peerDependencies?.[name]) pkg.peerDependencies[name] = '*';
  }
  fs.writeFileSync('$CODING_AGENT/package.json', JSON.stringify(pkg, null, '\t') + '\n');
"

# ── Pack and install coding-agent ─────────────────────────────────────────
echo "▸ Packing @cwilson613/pi-coding-agent..."
TARBALL=$(cd "$CODING_AGENT" && npm pack --pack-destination "$STAGING" 2>/dev/null | tail -1)
TARBALL_PATH="$STAGING/$TARBALL"

if [[ ! -f "$TARBALL_PATH" ]]; then
  echo "✗ Pack failed — tarball not found" >&2
  exit 1
fi

echo "  → $TARBALL_PATH"

echo "▸ Installing globally..."
npm install -g "$TARBALL_PATH" 2>&1 | grep -v "^npm warn"

# ── Verify ────────────────────────────────────────────────────────────────
INSTALLED_VERSION=$(pi --version 2>/dev/null || echo "FAILED")
echo ""
echo "✓ pi $INSTALLED_VERSION installed globally"

GLOBAL_PKG="/opt/homebrew/lib/node_modules/@cwilson613/pi-coding-agent"
if [[ -L "$GLOBAL_PKG" ]]; then
  echo "⚠ WARNING: Global install is a symlink — deps may not resolve correctly"
elif [[ ! -d "$GLOBAL_PKG/node_modules/@sinclair/typebox" ]]; then
  echo "⚠ WARNING: @sinclair/typebox not found in global install"
else
  echo "✓ Dependencies resolved"
fi

echo "✓ Done"
