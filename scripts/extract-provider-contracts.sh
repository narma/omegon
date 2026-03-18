#!/bin/bash
# Extract provider API contract fingerprints from upstream SDK packages.
#
# Sources:
#   - @anthropic-ai/sdk (vendored via pi-mono/node_modules)
#   - openai SDK (vendored via pi-mono/node_modules)
#   - pi-ai provider wrappers (for OAuth constants, beta headers, tool name mappings)
#
# Produces a JSON snapshot that CI compares daily against the previous snapshot.
# Any change = potential drift that requires Rust client updates.
#
# Usage: ./scripts/extract-provider-contracts.sh [pi-mono-path]

set -euo pipefail

PI_MONO="${1:-vendor/pi-mono}"
ANTH_SDK="$PI_MONO/node_modules/@anthropic-ai/sdk"
OAI_SDK="$PI_MONO/node_modules/openai"
AI_PROVIDERS="$PI_MONO/packages/ai/dist/providers"
AI_OAUTH="$PI_MONO/packages/ai/dist/utils/oauth"

die() { echo "ERROR: $*" >&2; exit 1; }
[ -d "$ANTH_SDK" ] || die "@anthropic-ai/sdk not found at $ANTH_SDK"

# ── SDK versions ─────────────────────────────────────────────────────────────

anth_sdk_version=$(grep '"version"' "$ANTH_SDK/package.json" | head -1 | grep -o '"[0-9][^"]*"' | tr -d '"')
oai_sdk_version=$(grep '"version"' "$OAI_SDK/package.json" 2>/dev/null | head -1 | grep -o '"[0-9][^"]*"' | tr -d '"' || echo "unknown")

# ── Anthropic API contract ───────────────────────────────────────────────────

anth_api_version=$(grep "anthropic-version" "$ANTH_SDK/client.js" | grep -o "'[^']*'" | tr -d "'" | head -1)

# SSE event types the SDK knows about (from MessageStream.js)
anth_sse_events=$(grep -o "'[a-z_]*'" "$ANTH_SDK/lib/MessageStream.js" 2>/dev/null | tr -d "'" | sort -u | grep -E '^(message_|content_block|input_json|text_delta|thinking|citation|signature|server_tool)' | paste -sd, -)

# Content block types from the SDK type definitions
anth_block_types=$(grep -roh "'text'\|'thinking'\|'redacted_thinking'\|'tool_use'\|'tool_result'\|'image'\|'document'\|'server_tool_use'" "$ANTH_SDK/resources/" 2>/dev/null | tr -d "'" | sort -u | paste -sd, -)

# ── Anthropic OAuth (from pi-ai, not the SDK) ────────────────────────────────

# The OAuth flow constants live in pi-ai, not the Anthropic SDK
anth_oauth_file="$AI_OAUTH/anthropic.js"
if [ -f "$anth_oauth_file" ]; then
  # decode() wraps a base64 CLIENT_ID — extract the decoded value
  anth_oauth_client_id=$(grep 'CLIENT_ID' "$anth_oauth_file" | grep -o 'decode("[^"]*")' | grep -o '"[^"]*"' | tr -d '"' | head -1)
  # If it's base64, decode it
  if [ -n "$anth_oauth_client_id" ]; then
    anth_oauth_client_id=$(echo "$anth_oauth_client_id" | base64 -d 2>/dev/null || echo "$anth_oauth_client_id")
  fi
  anth_oauth_authorize=$(grep 'AUTHORIZE_URL' "$anth_oauth_file" | grep -o '"https://[^"]*"' | tr -d '"' | head -1)
  anth_oauth_token=$(grep 'TOKEN_URL' "$anth_oauth_file" | grep -o '"https://[^"]*"' | tr -d '"' | head -1)
  anth_oauth_port=$(grep 'CALLBACK_PORT' "$anth_oauth_file" | grep -o '[0-9]*' | head -1)
  anth_oauth_scopes=$(grep 'SCOPES' "$anth_oauth_file" | grep -o '"[^"]*"' | tail -1 | tr -d '"')
else
  anth_oauth_client_id=""; anth_oauth_authorize=""; anth_oauth_token=""
  anth_oauth_port="0"; anth_oauth_scopes=""
fi

# ── Anthropic beta headers + Claude Code version (from pi-ai provider) ───────

anth_pi_file="$AI_PROVIDERS/anthropic.js"
anth_cc_version=$(grep 'claudeCodeVersion' "$anth_pi_file" | grep -o '"[^"]*"' | head -1 | tr -d '"')
anth_beta_fragments=$(grep -o 'claude-code-[0-9]*\|oauth-[0-9-]*\|interleaved-thinking-[0-9-]*' "$anth_pi_file" | sort -u | paste -sd, -)

# Claude Code tool name mappings
anth_cc_tools=$(grep -o '"[A-Z][a-zA-Z]*"' "$anth_pi_file" | tr -d '"' | sort -u | paste -sd, -)

# ── OpenAI Codex OAuth ───────────────────────────────────────────────────────

oai_oauth_file="$AI_OAUTH/openai-codex.js"
if [ -f "$oai_oauth_file" ]; then
  oai_oauth_client_id=$(grep 'const CLIENT_ID' "$oai_oauth_file" | grep -o '"[^"]*"' | head -1 | tr -d '"')
  oai_oauth_authorize=$(grep 'AUTHORIZE_URL' "$oai_oauth_file" | grep -o '"https://[^"]*"' | tr -d '"' | head -1)
  oai_oauth_token=$(grep 'TOKEN_URL' "$oai_oauth_file" | grep -o '"https://[^"]*"' | tr -d '"' | head -1)
  oai_oauth_redirect=$(grep 'REDIRECT_URI' "$oai_oauth_file" | grep -o '"http[^"]*"' | tr -d '"' | head -1)
  oai_oauth_scope=$(grep '^const SCOPE ' "$oai_oauth_file" | grep -o '"[^"]*"' | tr -d '"' | head -1)
else
  oai_oauth_client_id=$(grep 'const CLIENT_ID' "$oai_oauth_file" | grep -o '"[^"]*"' | head -1 | tr -d '"')
  oai_oauth_redirect=""; oai_oauth_scope=""
fi

# ── OpenAI Codex API ─────────────────────────────────────────────────────────

oai_codex_file="$AI_PROVIDERS/openai-codex-responses.js"
if [ -f "$oai_codex_file" ]; then
  oai_codex_base_url=$(grep 'DEFAULT_CODEX_BASE_URL' "$oai_codex_file" | grep -o '"https://[^"]*"' | tr -d '"' | head -1)
else
  oai_codex_base_url=""
fi

# ── pi-mono commit ───────────────────────────────────────────────────────────

pi_commit=$(cd "$PI_MONO" && git rev-parse --short HEAD 2>/dev/null || echo "unknown")

# ── Output ───────────────────────────────────────────────────────────────────

cat << EOF
{
  "schema_version": 2,
  "extracted_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "pi_mono_commit": "$pi_commit",
  "sdk_versions": {
    "anthropic": "$anth_sdk_version",
    "openai": "$oai_sdk_version"
  },
  "anthropic": {
    "api_version": "$anth_api_version",
    "sse_events": "$anth_sse_events",
    "block_types": "$anth_block_types",
    "claude_code_version": "$anth_cc_version",
    "beta_fragments": "$anth_beta_fragments",
    "cc_tool_names": "$anth_cc_tools"
  },
  "anthropic_oauth": {
    "client_id": "$anth_oauth_client_id",
    "authorize_url": "$anth_oauth_authorize",
    "token_url": "$anth_oauth_token",
    "callback_port": ${anth_oauth_port:-0},
    "scopes": "$anth_oauth_scopes"
  },
  "openai_codex_oauth": {
    "client_id": "$oai_oauth_client_id",
    "authorize_url": "$oai_oauth_authorize",
    "token_url": "$oai_oauth_token",
    "redirect_uri": "$oai_oauth_redirect",
    "scope": "$oai_oauth_scope"
  },
  "openai_codex_api": {
    "base_url": "$oai_codex_base_url"
  }
}
EOF
