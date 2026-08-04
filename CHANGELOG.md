# Changelog

## 1.0.22 — 2026-08-03

Documentation and package metadata only. No changes to the generator or the generated output — regenerating is not necessary.

### Changed

- Rewrote the README against the generator's actual behavior. It now documents how methods are classified as queries vs. mutations, how cache resource keys are derived from method names, how infinite queries are detected, the `out` path relationship the generated imports depend on, and the `x-api-key` header the auth resolver feeds.
- Added a "Known limitations" section covering single-service generation, unary-only support, `any`-typed hook inputs, `onSuccess` overriding the automatic invalidation, and the global `BigInt.prototype.toJSON` patch.
- npm `description` and `keywords` updated for discoverability on the registry.

## 1.0.21 — 2026-07-30

### Fixed

- **The generated transport now works with both `@connectrpc/connect-web` v1 (>= 1.6) and v2.** Previous releases passed `fetchOptions: { credentials: "include" }` to `createConnectTransport`. That option does not exist in any version of connect-web — it was silently ignored at runtime, and it fails type-checking in projects on connect-web v2 (which also removed the v1 `credentials` transport option). The generated client now applies the credentials mode through a `fetch` override, which is valid in both major versions and is the approach recommended by the Connect-ES v2 migration guide.
- The plugin's internal version string now reads from `package.json` instead of a hardcoded value.

### Added

- `setFetchCredentials(mode)` runtime setter exported by the generated client. Accepts `"include"`, `"same-origin"`, or `"omit"`; defaults to `"include"`. Changes take effect on the next request without rebuilding the transport.

### Behavior change — read before regenerating production apps

Because `fetchOptions` was silently ignored, apps generated with 1.0.19/1.0.20 have actually been running on the browser default (`"same-origin"`). Starting with this release, `credentials: "include"` genuinely takes effect:

- **Same-origin APIs:** no change — browsers send cookies same-origin under both modes.
- **Cross-origin APIs whose CORS allows credentials** (`Access-Control-Allow-Credentials: true` plus an exact, non-wildcard `Access-Control-Allow-Origin`): cookies are now sent, which is what 1.0.19 intended.
- **Cross-origin APIs with `Access-Control-Allow-Origin: *`** or without allow-credentials: requests will start failing CORS checks after regeneration. Either update the backend CORS configuration, or call `setFetchCredentials("same-origin")` at app startup to keep today's behavior exactly.

Nothing changes for a deployed app until you regenerate its SDK with this version and redeploy.

## 1.0.20 and earlier

See git history.
