# Anthropic subscription ToS compliance

Anthropic's consumer subscription appears to be intended for interactive use, not unattended automation. Omegon warns when you use Claude.ai / Anthropic subscription credentials in headless or background flows, but the harness does not fully remove the operator's ability to proceed.

## What Omegon warns about

When Anthropic subscription auth is the only Anthropic credential available, Omegon treats these entry points as follows:

| Entry point | Omegon behavior | Notes |
| --- | --- | --- |
| TUI mode | Allowed | Human-operated interactive sessions are the least ambiguous case. |
| `--initial-prompt` | Allowed | Seeding an interactive TUI session with an initial prompt still leaves a human in the loop. |
| `--prompt` / `--prompt-file` | Warns, then proceeds | These are headless entry points and may fall on the wrong side of Anthropic's consumer terms. |
| `--smoke` | Warns, then proceeds | Smoke runs are automated checks. |
| `/cleave` | Warns, then proceeds | Parallel/background agent work is the clearest foot-gun. |

If you need scripted, headless, or background use, get an Anthropic API key and set `ANTHROPIC_API_KEY`.

That is the clean path for automation. Keep the subscription login for interactive sessions, and use the API key for programmatic workflows. Omegon will still let you proceed with the subscription path after warning, but it will not pretend that path is risk-free.

## Summary matrix

| Credential mode | Automation posture | Notes |
| --- | --- | --- |
| Anthropic API key | Unrestricted | Headless and automated use are allowed, subject to Anthropic's API terms and limits. |
| Anthropic subscription / OAuth | Warning-only for automation | Fine for interactive TUI use; Omegon warns rather than hard-blocking automated/headless use. |
| OpenAI API key | Unrestricted | Standard API-key flow. |
| Codex OAuth | Unrestricted | No Anthropic-style subscription restriction in Omegon. |
| Ollama | Unrestricted | Local inference, no external auth. |
| GitHub Copilot | Unrestricted | GitHub Copilot has no analogous interactive-only restriction here. |

The warnings exist to keep Omegon aligned with provider terms and to protect the operator from accidental policy violations, while preserving operator agency.
