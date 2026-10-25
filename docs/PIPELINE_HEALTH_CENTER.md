# Pipeline Health & Recovery Center

## Goal

Give the Shorts Automation dashboard an actionable, continuously refreshed view of external dependencies and the pipeline functionality each dependency supports. This is an implementation contract, not a claim that any provider is currently down.

## Requirements

1. Show global status: Healthy, Degraded, or Critical, plus last checked time.
2. Monitor configured dependencies only. Initial candidates:
   - FreeLLMAPI primary endpoint and configured fallback endpoint
   - Gemini fallback (configuration presence and a low-cost authenticated probe where supported)
   - Kaggle API / runner endpoint only when configured
   - CloudFront distribution or asset URL only when configured
   - PostgreSQL/Supabase connection
   - Pexels, Instagram Graph API, YouTube Data API, Telegram bot, and any configured cloud-render endpoint
   - Local dependencies: FFmpeg, FFprobe, yt-dlp, writable temp/output directories, and required asset folders
3. Each check returns: dependency key, display name, status (healthy/degraded/down/not_configured/unknown), severity, latency, last checked, sanitized error, and affected capabilities.
4. Maintain an explicit dependency-to-capability map. Example: FreeLLMAPI affects AI vision and metadata; Gemini is a fallback for supported AI calls; CloudFront affects only configured assets/routes served through it; Kaggle affects only jobs delegated to the configured Kaggle runner. Do not claim all pipeline features fail when a provider is down.
5. Map failures to actual degraded features, including: vision/branding detection, OCR, caption/metadata generation, stock-footage retrieval, voiceover generation, video rendering, audio mixing, media downloading, database/history, and each publishing target.
6. Deduplicate alerts. Notify on status transitions and after a configurable sustained-failure threshold; notify again on recovery. Avoid alert storms.
7. The dashboard shows a warning banner and a dependency table. Each incident includes symptoms, affected functions, evidence (HTTP status/error category and time), probable causes, safe remediation steps, and a "Test again" action.
8. Use authenticated probes, short timeouts, bounded concurrency, and rate limits. Never expose API keys, tokens, signed URLs, full authorization headers, or sensitive provider response bodies.
9. Never automatically rotate credentials, change DNS/CDN configuration, delete jobs, or publish/retry content as part of a health check. Recovery actions must be explicit and safe.
10. A health check must not use an expensive generation/upload call. Use provider health endpoints where available and a minimal authenticated request otherwise; clearly label checks that verify only reachability rather than end-to-end functionality.
11. FreeLLMAPI must provide a diagnosis/solution prompt on the dashboard when it is reachable. If FreeLLMAPI itself is down, show a deterministic local troubleshooting guide or use the configured fallback provider; never depend on the failing service to explain its own outage.
12. Track incident history (first seen, last seen, count, recovery time) so recurring instability can be diagnosed.

## Suggested incident card

- **Provider:** FreeLLMAPI
- **Status:** Degraded / Down
- **Evidence:** timeout / HTTP 429 / HTTP 5xx / authentication error
- **Affected features:** AI vision, captions, metadata (based on the actual call path and fallback result)
- **Current mitigation:** Gemini fallback available / unavailable
- **Suggested fix:** verify endpoint and key configuration; inspect quota/rate limits; test fallback; retry failed jobs only after recovery
- **Actions:** Test again; View logs; Copy diagnostic report

## Status semantics

- Healthy: probe succeeded.
- Degraded: primary failed but a usable fallback exists, or the dependency is partially functional.
- Down: repeated probe failure or confirmed non-retryable configuration/auth failure.
- Unknown: no reliable probe result yet.
- Not configured: dependency is not used by this deployment and should not be treated as an outage.

Use consecutive failures and recovery checks to avoid flapping. Distinguish service outage (timeout/5xx), quota/rate limit (429), authentication/configuration (401/403), and application-level failures.

## Implementation sequence

1. Inventory actual configured endpoints and call sites; identify the dashboard server and client routes.
2. Add a typed health-check registry and dependency-to-capability map.
3. Add a server endpoint protected by the dashboard's existing authentication.
4. Add a dashboard Health panel, polling at a modest interval and allowing manual checks.
5. Add transition-based alerts and incident history.
6. Add AI-generated remediation using sanitized diagnostics, with a deterministic local fallback.
7. Add tests for status classification, feature impact mapping, secret redaction, alert deduplication, and provider-down behavior.
8. Verify build/tests and validate against a staging deployment before enabling notifications.

## Acceptance criteria

- A simulated FreeLLMAPI timeout visibly marks the provider degraded/down and identifies affected features.
- If Gemini fallback succeeds, affected AI features are marked degraded rather than unavailable.
- If both AI providers fail, the dashboard shows a clear blocked state and safe next steps without relying on FreeLLMAPI.
- Unconfigured Kaggle/CloudFront dependencies show Not configured, not Down.
- A publishing API outage identifies only that publishing target as blocked; rendering can continue where safe.
- Secrets are redacted from every displayed/logged diagnostic.
- Recovery generates one recovery notice, not repeated alerts.
