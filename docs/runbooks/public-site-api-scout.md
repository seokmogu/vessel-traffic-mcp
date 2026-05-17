# Public no-login vessel tracking API scout

Purpose: discover only browser-visible, no-login vessel-position request shapes for adapter planning. This is **not** a scraping run and must not bypass access controls.

Follow-up: [`browser-api-capture-results.md`](./browser-api-capture-results.md)
records the later search-input probes for vessel-name autocomplete,
IMO/MMSI lookup, detail pages, and latest-position candidates. Treat
that file as the current source for adapter tickets; this file is the
initial broad scout.

## Method

Use the `/Users/aktn/project/api-capture` Playwright reconnaissance workflow, not ad-hoc browser poking:

```bash
cd /Users/aktn/project/api-capture
.venv/bin/python scripts/site_recon.py <target-url> --max-pages 2 --wait-ms 2500
```

The recon loop records XHR/fetch/document signatures, generates site profiles/config hints/plans, and lets a human/LLM decide next safe actions from DOM/network observations.

Rules for this scout:

- Exclude services that require login, paid session, CAPTCHA, Cloudflare/bot-defense bypass, or non-public account state.
- If a site responds with `403`, CAPTCHA/challenge, login-required, or Cloudflare block, stop and mark it excluded. Do not bypass.
- Record sanitized endpoint shapes only: host, path, method, query parameter names/types, response purpose, and access status.
- Do not store cookies, auth headers, session ids, CSRF tokens, HAR files, or raw private captures in this repository.
- Do not replay at scale. One bounded browser recon pass per site is enough until terms/rate limits are reviewed.
- Prefer official APIs/open-data feeds for implementation when available.

## 2026-05-17 API-capture recon results

### MyShipTracking

- Site: `https://www.myshiptracking.com/`
- api-capture session: `/Users/aktn/project/api-capture/sessions/recon_20260517T141040_5fc81d`
- Generated files:
  - `/Users/aktn/project/api-capture/config/sites/myshiptracking.com.yaml`
  - `/Users/aktn/project/api-capture/config/hints/myshiptracking.com_autogen.md`
  - `/Users/aktn/project/api-capture/config/plans/myshiptracking.com_plan.yaml`
- Access result: public map and vessel list pages loaded without login.
- Endpoint inventory count: 7 signatures.
- Candidate public map endpoint:
  - Method: `GET`
  - Host: `www.myshiptracking.com`
  - Path: `/requests/vesselsonmaptempTTT.php`
  - Observed query parameters:
    - `type=json`
    - `minlat`, `maxlat`, `minlon`, `maxlon` — map viewport bounds
    - `zoom` — map zoom level
    - `selid`, `seltype` — selected object marker/id controls
    - `timecode` — temporal/playback control; public map used `-1`
    - `filters` — URL-encoded JSON including vessel types, ports, speed/size/build-year/status/origin/destination filters
- Related public request shapes:
  - `GET /requests/areas/get_areas.php`
  - `POST /requests/user/get-settings.php`
  - `GET /fleet/get-fleets-form`
- Login/account signal:
  - `GET /login-box` is requested by the public page, but recon did not authenticate. Account/fleet features remain excluded.
- Adapter candidate status: **strong no-login candidate**, pending terms/rate-limit review and sanitized fixture promotion.

### ShipXplorer

- Site: `https://www.shipxplorer.com/`
- api-capture session: `/Users/aktn/project/api-capture/sessions/recon_20260517T141056_5283c4`
- Generated files:
  - `/Users/aktn/project/api-capture/config/sites/shipxplorer.com.yaml`
  - `/Users/aktn/project/api-capture/config/hints/shipxplorer.com_autogen.md`
  - `/Users/aktn/project/api-capture/config/plans/shipxplorer.com_plan.yaml`
- Access result: public map loaded without login; subscription/login surfaces exist and must be excluded.
- Endpoint inventory count: 7 signatures from bounded site recon.
- Candidate public endpoint shapes:
  - `GET https://www.shipxplorer.com/data/ports/popular?v=`
  - Previous browser observation also saw public map feed shapes on `data.shipxplorer.com`:
    - `GET /live` with `bounds`, `zoom`, `lastReport`, `trackLength`, `types[]`, `status[]`, `ais`, `sate`, etc.
    - `GET /feed?feed=mostTracked&owner=`
- Login/account signal:
  - `/login`, social auth, subscription pages, and locked detail features exist. Exclude paid/account features unless operator later uses an authorized subscription through a BYOK/official-provider path.
- Adapter candidate status: **candidate**, but stricter terms/rate review needed because public/free vs paid feature boundary is visible.

### ShipFinder

- Site: `https://www.shipfinder.com/`
- api-capture session: `/Users/aktn/project/api-capture/sessions/recon_20260517T141130_9211e4`
- Access result: public site loaded without login.
- Endpoint inventory count: 18 signatures.
- Candidate vessel endpoints now promoted into the explicit `shipfinder`
  adapter:
  - `GET https://searchv3.shipfinder.com/shipdata/search3.ashx?f=auto&kw=<query>`
  - `GET https://searchv3.shipfinder.com/shipdata/search3.ashx?f=srch&kw=<query>`
  - `POST https://www.shipfinder.com/ship/GetShip` with
    `application/x-www-form-urlencoded` body `mmsi=<mmsi>`
- Related map/fleet endpoint:
  - `POST https://www.shipfinder.com/Ship/getships`
  - Observed from `/` and `/special/hormuz`
- Related public request shapes:
  - `GET /Special/CrossStraitOfHormuzDetail?date=...`
  - `GET /Special/CrossStraitOfHormuzStats`
  - `GET /Special/GetHormuzNewsRecent?skip=...&limit=...`
  - `GET /Special/GetMacroIndex30Days`
- Login/account signal:
  - Public load triggered `GET /Home/Login?ReturnUrl=...` for user settings/guidance calls. Treat those account calls as excluded; do not authenticate.
- Adapter candidate status: **implemented as explicit adapter candidate**.
  Keep it out of default routing until terms/rate review and browser
  verification behavior are settled; direct non-browser `GetShip` calls can
  return abnormal-access responses.

### BoatNerd AIS

- Site: `https://ais.boatnerd.com/`
- api-capture session: `/Users/aktn/project/api-capture/sessions/recon_20260517T141209_618ed3`
- Access result: public map loaded without login.
- Endpoint inventory count: 3 signatures.
- Candidate public vessel endpoint:
  - Method: `GET`
  - Host: `ais.boatnerd.com`
  - Path: `/api/v1/vessels`
  - Observed query parameters:
    - `bbox` — polygon/bounding-box coordinates, observed as comma-separated coordinate pairs
- Related request shape:
  - `GET /api/v1/sponsored-banners`
- Adapter candidate status: **strong regional/open candidate** for Great Lakes coverage, pending terms/rate review.

### SeaRates vessel tracking

- Site: `https://www.searates.com/vessel-tracking/`
- api-capture session: `/Users/aktn/project/api-capture/sessions/recon_20260517T141144_bdf341`
- Access result: page returned 200, but recon observed Cloudflare challenge-platform traffic.
- Endpoint inventory count: 7 signatures.
- Notable request shapes:
  - `GET/POST /auth/platform-token`
  - `POST /auth/platform-info`
  - `POST /cdn-cgi/challenge-platform/...`
- Decision: **exclude from browser capture for now**. Do not bypass challenge/bot-defense. Revisit only via official API/docs or operator-approved normal access where terms allow.

### VesselFinder

- Site: `https://www.vesselfinder.com/`
- Access result from current browser environment: `403 Forbidden`.
- Decision: **exclude**. Do not bypass. Revisit only via official API/docs or authorized normal browser access if terms allow.

### MarineTraffic

- Site: `https://www.marinetraffic.com/`
- Access result from current browser environment: Cloudflare block page.
- Decision: **exclude from browser capture**. Use official API/BYOK provider path instead.

### FleetMon

- Site tried: `https://www.fleetmon.com/` / `https://fleetmon.com/`
- Access result from current environment: DNS resolution failure.
- Decision: not captured. Recheck later with correct domain/network, or use official API/docs if available.

## Candidate implementation order

1. BoatNerd AIS — clean public JSON endpoint, limited regional coverage.
2. MyShipTracking — public map endpoint with viewport query.
3. ShipFinder — explicit adapter candidate implemented for autocomplete +
   `GetShip`; default routing remains disabled pending terms/rate and
   browser-verification review.
4. ShipXplorer — public map/feed shapes; strict boundary around subscription features.
5. Official/open APIs — BarentsWatch/OpenAIS/AISStream/AISHub/etc. where terms and auth are explicit.
6. Paid providers — MarineTraffic/VesselFinder/Spire/Datalastic/etc. only through BYOK credential profiles and official APIs, not public-page scraping.

## Adapter guardrails

For any adapter built from these shapes:

- Default disabled unless provider terms are reviewed.
- Concurrency 1, small max-calls, long cache TTL, and explicit viewport/entity allowlist.
- Never forward browser cookies, CSRF tokens, account/session identifiers, or challenge-platform artifacts.
- Use sanitized fixtures only; skip live calls by default in tests.
- Return source, timestamp, freshness, coverage caveats, and confidence in every MCP vessel-position response.
- Stop immediately on login, CAPTCHA, challenge, 403/429, or subscription/paywall boundary.
