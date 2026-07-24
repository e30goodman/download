# Research findings: Cannot reach download server after sleep/wake

Date: 2026-07-24  
Scope: Phase A only (no fixes applied). Phone testing not used (no device access).

## Incident snapshot

| Check | Result |
|---|---|
| Windows reboot | No (boot since 2026-07-18) |
| Wake | 2026-07-24 ~11:35 (S3 resume) |
| Local `127.0.0.1:3110/health` | `ok` (during investigation) |
| Live tunnel | `https://arising-till-outlets-eau.trycloudflare.com` → `/health` ok |
| Stale tunnel from incident | `https://front-encounter-everyone-pda.trycloudflare.com` → **DNS fail** |
| Pages `api-endpoint.json` (now) | same as live |
| Browser RPC host (Pages, now) | `arising-till-outlets-eau` — site works, no banner |

## Timeline (smoking gun)

```
11:35  wake (Power-Troubleshooter)
11:36  Detected resume/sleep gap of 44393s; forcing health recheck
11:36-11:37  live tunnel health failed 4/4 for lou-doubt-negotiation-whilst...
11:37:31  stop cloudflared; start new quick tunnel
11:37:48  NEW URL front-encounter-everyone-pda... + publish endpoint/Pages
11:39:25  API health failed (1/2)
11:39:52  API health failed (2/2)
11:40:15  Restarting API
11:41:12  API healthy; skip tunnel checks 45s
11:42:12-11:43:13  Tunnel process missing (1/4..4/4)
11:43:25  NEW URL arising-till-outlets-eau... + publish again
```

**Smoking gun:** after wake the public hostname is thrown away twice in ~6 minutes. Old hostnames stop resolving (`front-encounter...` DNS fail). Any client still using a previous `*.trycloudflare.com` sees “Cannot reach the download server” even while local API is fine.

## Hypothesis table

| ID | Verdict | Evidence |
|---|---|---|
| **H1** stale/rotated URL on client | **CONFIRMED** | Stale incident host DNS-fails; live host ok; during outage Pages lagged behind raw; baked Pages JS embeds current tunnel host and goes stale on next rotation |
| **H2** running supervisor ≠ hardened ops on disk | **CONFIRMED (contributing)** | AppData `supervisor.ps1` SHA ≠ repo script; AppData still has `Invoke-RestMethod` + threshold 3; repo has sticky/wake/`Test-ApiHealth`. Running PID logs wake-gap (hardened in memory). **Next task restart would load the older AppData file** |
| **H3** wake → API/tunnel repair rotates quick-tunnel hostname | **CONFIRMED (root mechanism)** | Timeline above; last ~10 publishes are almost all distinct hostnames; quick tunnels cannot keep the same URL across restart |
| **H4** mobile-only network | **NOT TESTED** | No phone access; not required — PC-side stale DNS already explains unreachable |
| **H5** UI recovery gaps | **PARTIAL (amplifier)** | `refreshData` calls `ensureResolvedApiUrl` **without** `force`; 30s endpoint cache; banner after 3 fails. `rpcFetch` does force on retry, but if published endpoints still point at a host that just died (between tunnel death and republish) retries cannot help |
| **H6** CORS/session mobile-specific | **NOT NEEDED** | Current browser session reaches `/rpc` successfully on live host |

## Proven cause (Phase A conclusion)

**Primary:** Cloudflare **quick tunnel** changes hostname on every restart. Sleep/wake makes tunnel (and often API) unhealthy; supervisor restarts tunnel → **new public URL**. Clients (and temporarily Pages) keep the old URL → fetch fails → “Cannot reach the download server”.

**Secondary:** Ops deploy drift — hardened supervisor in git is not reliably what sits in AppData for the next process start.

This is not “API permanently dead”. It is **public ingress identity churn** after resume.

## Phase B

See: [план решения sleep-wake unreachable](c:/Users/user/.cursor/plans/решение_sleep-wake_unreachable_h1h3.plan.md)
