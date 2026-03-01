#!/usr/bin/env bash
# Identity check — show current login state across dev tools
set -euo pipefail

echo "=== Git ==="
echo "User: $(git config user.name 2>/dev/null || echo 'not set') <$(git config user.email 2>/dev/null || echo 'not set')>"

echo ""
echo "=== GitHub (gh) ==="
if command -v gh &>/dev/null; then
  gh auth status 2>&1 || echo "Not authenticated"
else
  echo "gh CLI not installed"
fi

echo ""
echo "=== GitLab (glab) ==="
if command -v glab &>/dev/null; then
  glab auth status 2>&1 || echo "Not authenticated"
else
  echo "glab CLI not installed"
fi

echo ""
echo "=== AWS ==="
if command -v aws &>/dev/null; then
  aws sts get-caller-identity 2>&1 || echo "Not authenticated"
else
  echo "aws CLI not installed"
fi

echo ""
echo "=== Kubernetes ==="
if command -v kubectl &>/dev/null; then
  echo "Context: $(kubectl config current-context 2>/dev/null || echo 'none')"
  kubectl auth whoami 2>&1 || kubectl auth can-i --list 2>&1 | head -5 || echo "Cannot determine identity"
else
  echo "kubectl not installed"
fi
