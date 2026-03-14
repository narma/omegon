#!/usr/bin/env bash
# Publish pi-mono fork packages to npm if their versions don't match what's on the registry.
# Called by CI before publishing omegon itself.
# Also rewrites omegon's package.json to use registry versions instead of file: refs.
set -euo pipefail

PACKAGES=("ai" "tui" "coding-agent")
SCOPED_NAMES=("@cwilson613/pi-ai" "@cwilson613/pi-tui" "@cwilson613/pi-coding-agent")
BASE="vendor/pi-mono/packages"

published=()

for i in "${!PACKAGES[@]}"; do
  pkg="${PACKAGES[$i]}"
  name="${SCOPED_NAMES[$i]}"
  dir="$BASE/$pkg"

  if [ ! -d "$dir" ]; then
    echo "⚠ Skipping $name — $dir not found"
    continue
  fi

  local_ver=$(node -p "require('./$dir/package.json').version")
  npm_ver=$(npm view "$name" version 2>/dev/null || echo "0.0.0")

  if [ "$local_ver" = "$npm_ver" ]; then
    echo "✓ $name@$local_ver already published"
  else
    echo "→ Publishing $name@$local_ver (registry has $npm_ver)"
    (cd "$dir" && npm publish --access public)
  fi

  published+=("$name@$local_ver")
done

# Rewrite omegon package.json: file: refs → registry versions
echo ""
echo "Rewriting package.json file: refs to registry versions..."
for i in "${!PACKAGES[@]}"; do
  pkg="${PACKAGES[$i]}"
  name="${SCOPED_NAMES[$i]}"
  dir="$BASE/$pkg"
  ver=$(node -p "require('./$dir/package.json').version")

  # Replace file: ref with pinned version
  node -e "
    const fs = require('fs');
    const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
    if (pkg.dependencies['$name']?.startsWith('file:')) {
      pkg.dependencies['$name'] = '$ver';
      fs.writeFileSync('package.json', JSON.stringify(pkg, null, '\t') + '\n');
      console.log('  ✓ $name → $ver');
    } else {
      console.log('  - $name already pinned');
    }
  "
done

echo ""
echo "Done. pi-mono packages published and package.json updated for omegon publish."
