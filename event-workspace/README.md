# Event workspace: separate companion

Source for the real September11 temporary Tenki8081 demo: sourced agenda, six sponsor capabilities, opt-in signup, consent-only directory and private withdrawal. This is not official event registration. The original preview expires2026-09-11T22:15:17.262Z (3:15PM PDT); source remains reviewable afterwards. Mail is held; no participant email sending is enabled.

## Verify locally
Run from the exported repository root:
```sh
cd event-workspace
bun install --frozen-lockfile
bun test tests
bun run check
```
Bun1.3.10 is the tested host; the recorded Tenki guest used1.3.14. SQLite tests run in memory with fake senders. The export self-check runs these tests and the worker TypeScript check; the dedicated nested dependency scan includes pinned Wrangler4.96.0 and TypeScript5.9.3.

## Runtime
`runtime/bun-server.ts` uses the same handler/domain/store/followup modules with Bun SQLite. For an already authorized isolated guest, copy src/, runtime/, migrations/ and the exact nine STATIC_FILES public assets. Create private data/ and operator-owned runtime-config.json containing the approved HTTPS origin and actual expiresAt. Start with `bun runtime/bun-server.ts`; it binds8081, applies both migrations once, holds mail and closes/purges visitor records at expiry. The demo uses a conservative shared five-signups/hour bucket because a public client cannot be trusted to supply a Cloudflare IP header. No runtime data or private configuration is shipped.

The included Wrangler configuration is a held alternative: zero database-ID placeholder, signup/mail disabled. The original account was Workers Paid, so the free-only condition did not authorize a Cloudflare Worker/D1 deployment; the accepted demo ran on an existing Tenki computer. No command in the export self-check deploys it.

## Privacy and provenance
Consent is explicit; directory fields exclude email. Withdrawal redacts personal fields; failed scheduling can delay deletion in a persistent operator deployment. Mail requires the exact fixed resource hash plus an authorized trusted sender; the browser has no arbitrary send endpoint. The source migration preserves one historical, operator-approved Gmail self-test acceptance slot; it does not send mail. Accepted is not delivery.

Source modules, tests, SQL, held configuration and official marks are copied verbatim with manifest source hashes. This portable README replaces the internal deployment notes, whose hash is retained. The original EVENT lane reported 18 tests / 103 assertions, actual public synthetic signup201 then withdrawal, and restored empty directory. The exported self-check records the exact current test result independently.
