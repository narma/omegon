#!/bin/bash
# Compare current provider API contracts against the baseline snapshot.
# Exits non-zero if drift is detected. Output describes what changed.
#
# Usage: ./scripts/check-provider-drift.sh

set -euo pipefail

BASELINE=".pi/provider-contracts.json"
CURRENT=$(mktemp)
trap "rm -f $CURRENT" EXIT

# Extract current contracts
./scripts/extract-provider-contracts.sh > "$CURRENT"

if [ ! -f "$BASELINE" ]; then
  echo "No baseline found at $BASELINE — creating it."
  cp "$CURRENT" "$BASELINE"
  echo "Baseline created. Run again to compare."
  exit 0
fi

# Compare key fields (ignore extracted_at and pi_mono_commit which always change)
DRIFT=0
REPORT=""

compare_field() {
  local path="$1"
  local label="$2"
  local old=$(python3 -c "import json; print(json.load(open('$BASELINE'))$(echo $path))" 2>/dev/null || echo "")
  local new=$(python3 -c "import json; print(json.load(open('$CURRENT'))$(echo $path))" 2>/dev/null || echo "")
  if [ "$old" != "$new" ]; then
    DRIFT=1
    REPORT="$REPORT\n⚠️  $label changed:\n   was: $old\n   now: $new\n"
  fi
}

# SDK versions
compare_field "['sdk_versions']['anthropic']"         "Anthropic SDK version"
compare_field "['sdk_versions']['openai']"            "OpenAI SDK version"

# Anthropic API
compare_field "['anthropic']['sse_events']"           "Anthropic SSE event types"
compare_field "['anthropic']['block_types']"          "Anthropic content block types"
compare_field "['anthropic']['claude_code_version']"  "Claude Code version"
compare_field "['anthropic']['beta_fragments']"       "Anthropic beta headers"
compare_field "['anthropic']['cc_tool_names']"        "Claude Code tool names"

# Anthropic OAuth
compare_field "['anthropic_oauth']['client_id']"      "Anthropic OAuth client ID"
compare_field "['anthropic_oauth']['authorize_url']"  "Anthropic OAuth authorize URL"
compare_field "['anthropic_oauth']['token_url']"      "Anthropic OAuth token URL"
compare_field "['anthropic_oauth']['callback_port']"  "Anthropic OAuth callback port"
compare_field "['anthropic_oauth']['scopes']"         "Anthropic OAuth scopes"

# OpenAI Codex OAuth
compare_field "['openai_codex_oauth']['client_id']"     "OpenAI Codex OAuth client ID"
compare_field "['openai_codex_oauth']['authorize_url']" "OpenAI Codex OAuth authorize URL"
compare_field "['openai_codex_oauth']['token_url']"     "OpenAI Codex OAuth token URL"
compare_field "['openai_codex_oauth']['redirect_uri']"  "OpenAI Codex OAuth redirect URI"
compare_field "['openai_codex_oauth']['scope']"         "OpenAI Codex OAuth scope"

# OpenAI Codex API
compare_field "['openai_codex_api']['base_url']"        "OpenAI Codex API base URL"

if [ $DRIFT -eq 0 ]; then
  echo "✓ No provider API drift detected."
  echo "  Anthropic SDK: $(python3 -c "import json; print(json.load(open('$BASELINE'))['sdk_versions']['anthropic'])")"
  echo "  OpenAI SDK:    $(python3 -c "import json; print(json.load(open('$BASELINE'))['sdk_versions']['openai'])")"
  exit 0
else
  echo "⚠️  PROVIDER API DRIFT DETECTED"
  echo ""
  echo -e "$REPORT"
  echo ""
  echo "Action required:"
  echo "  1. Review the changes above"
  echo "  2. Update Rust clients in core/crates/omegon/src/providers.rs and auth.rs"
  echo "  3. Run: ./scripts/extract-provider-contracts.sh > .pi/provider-contracts.json"
  echo "  4. Commit the updated baseline"
  exit 1
fi
