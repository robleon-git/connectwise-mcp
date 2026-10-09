# Owner dogfood release gate

This manual QA gate is mandatory for any release affecting MCP authentication, identity/account resolution, entitlement enforcement, ConnectWise connection/credential resolution, client construction, tool registration, or MCP execution. An SDK diagnostic alone is not a substitute.

Use Rob's ORDINARY customer identity (`rob@monotorr.com`) in production ChatGPT with `https://api.monotorr.com/mcp`. Do not use the separate super-admin identity, impersonation, a temporary authorization exemption, global credential fallback, or an entitlement bypass.

Before approval, record the source SHA/image digest/revision and confirmed normal customer account/entitlement/own connection. The current pilot has not implemented the V1 account/entitlement model; do not claim those checks already exist. After V1 account resolution is implemented they must be explicitly verified on every affected release.

Checklist:

- [ ] Rob signs in as the ordinary customer; no implicit/admin privileges.
- [ ] Production ChatGPT uses the production MCP connector and completes authentication/discovery.
- [ ] Exactly the existing 39 read-only tools are available in configured mode.
- [ ] Execute one known read against Rob's own instance: `cw_test_connection` returning connected:true, or another pre-agreed bounded read that demonstrates the expected instance.
- [ ] Confirm the result belongs to Rob's configured connection; do not export response bodies, company/ticket identifiers, screenshots with customer data, keys, bearer tokens, or raw claims into release artifacts.
- [ ] No write occurs and no administrative bypass was used.
- [ ] Record PASS/FAIL, timestamp, release identifier, tool name, and sanitized outcome, reviewed by the owner/release approver.

A failed or missing manual smoke blocks completion/promotion of the affected MCP release. Reauthentication or a new connection can be tested if required by the actual change; do not weaken OAuth to recover a test.

The Phase 0 workflow cannot deploy MCP at all. A later reviewed MCP delivery extension must enforce this sign-off in the protected release approval path before affected releases are accepted. Do not claim a generic checkbox or an automated boolean proves the human ChatGPT test.
