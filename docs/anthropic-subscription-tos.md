# Anthropic subscription ToS compliance

Anthropic's consumer subscription is interactive-only in Omegon. That is a narrow, factual boundary: if you are signed in with the Claude.ai / Anthropic subscription flow, you can use the TUI, but you must not use headless or automated entry points.

Anthropic's Consumer Terms make that restriction explicit. The exact ToS page is:

<https://www.anthropic.com/legal/consumer-terms>

> Except when you are accessing our Services via an Anthropic API Key or where we otherwise explicitly permit it, to access the Services through automated or non-human means, whether through a bot, script, or otherwise.

## What Omegon allows vs blocks

When Anthropic subscription auth is the only Anthropic credential available, Omegon treats these entry points as follows:

| Entry point | Status | Notes |
| --- | --- | --- |
| TUI mode | Allowed | Human-operated interactive sessions are fine. |
| `--initial-prompt` | Allowed | Seeding an interactive TUI session with an initial prompt is still interactive use. |
| `--prompt` / `--prompt-file` | Blocked | These are headless, automated entry points. |
| `--smoke` | Blocked | Smoke runs are automated checks, not interactive use. |
| `/cleave` | Blocked | Parallel agent work is background automation. |

## If you need automation

If you need scripted, headless, or background use, get an Anthropic API key and set `ANTHROPIC_API_KEY`.

That is the supported path for automation. Keep the subscription login for interactive sessions, and use the API key for programmatic workflows.

## How this compares to other providers

Most other provider auth modes do not have this specific consumer-subscription boundary in Omegon.

| Provider / mode | Status | Notes |
| --- | --- | --- |
| Anthropic API key | Unrestricted | Headless and automated use are allowed, subject to Anthropic's API terms and limits. |
| Anthropic subscription / OAuth | Interactive only | Allowed in the TUI; blocked for headless automation. |
| OpenAI API key | Unrestricted | Standard API-key flow. |
| Codex OAuth | Unrestricted | No Anthropic-style subscription restriction in Omegon. |
| Ollama | Unrestricted | Local inference, no external auth. |
| GitHub Copilot | Unrestricted | GitHub Copilot has no analogous interactive-only restriction here. |

The enforcement exists to keep Omegon aligned with provider terms and to protect the operator from accidental policy violations.