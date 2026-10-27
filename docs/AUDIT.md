# Arc Bridge 0.2.1 audit

Audited October 27, 2026 on Apple Silicon macOS with Electron 45 and Firefox 158.0.1. The audit uses synthetic archives, fixture URLs served on loopback, and fresh temporary Firefox profiles. No actual Arc/Firefox profile contents were inspected or migrated.

## Fixed

- Replaced numeric-ID ownership assumptions with extension-private Firefox session markers. Undo resolves restored tabs by marker and checks URL, pin state and owning window. Resume resolves restored windows by marker. Reused IDs and ambiguous copied markers cannot authorize deletion.
- Failed tab/bookmark removal leaves undo retryable. Changed bookmark folders stop resume. Marker-write interruptions pause replay for review rather than creating duplicates.
- Serialized desktop queue mutations, prevented overlapping extension polls/manual operations, rejected duplicate job/destination entries, and prevented multiple desktop instances sharing the same data directory.
- Kept receiver presence current during long jobs; disabling a receiver requests cancellation at the next operation boundary.
- Invalidated source-to-receiver mappings after inventory regrouping/selection changes. Added confirmation to progress-screen undo. Replacing a manual migration file resets consent and previews destination URLs.
- Rejected empty/oversized migration plans and bounded nested HTML title extraction.

## Verification

`npm test` passes 31 tests covering parsing, profile boundaries, URL validation, order/pinning, grouping fallback, retries, partial failure, cancellation, ownership checks, simulated restored/recycled IDs, ambiguous markers, companion polling/consent, and native framing/chunks/run authorization.

`npm run build`, `npm run lint:extension`, and `npm audit` pass. The extension linter reports zero errors, notices and warnings; npm reports zero known vulnerabilities at audit time.

The real Firefox/Electron integration check drives the source import, inventory, profile mapping, review, confirmation and migration UI. It creates two tabs and matching bookmarks, skips an unsafe link, checks pinning, retries without duplicates, restarts Firefox using the same temporary profile, verifies retained receiver identity, changes a tab/bookmark, and confirms undo preserves those changes. It then creates a 60-tab grouped migration through bounded native chunks, pauses partway through, resumes to exactly 60 tabs, verifies a real Firefox tab group, and undoes it. It also rejects a duplicate staging batch and checks that a second desktop launch exits while the original stays available. No renderer exceptions occur. The desktop/native host run with system-only PATH, without requiring developer Node.

Restart/recycled-ID failure cases are additionally covered by deterministic unit tests. Multiple simultaneous real Firefox profiles, 20,000-tab scale, every Arc export variant, and every operating-system/browser combination are not covered by this test.

## Remaining release limits

- The exact current official Arc export schema has not been observed. HTML and the versioned portable format are supported; the undocumented sidebar adapter remains experimental. Synthetic fixtures do not establish compatibility with every real Arc export.
- The Firefox companion is unsigned and must be loaded again after a browser restart. The integration test reloads it and verifies retained identity in that test profile; clearing/uninstalling extension storage can still lose identity/journals. Persistent installation needs Mozilla signing.
- The Mac beta is ad-hoc signed, not Apple-notarized. Normal public distribution needs Apple signing/notarization. This build targets Apple Silicon macOS 13 or newer and Firefox 142 or newer.
- Authentication, cookies, passwords, history, extensions and settings do not migrate. Missing source profile metadata requires explicit user grouping/mapping.
- Legacy tab journals without ownership markers preserve their tabs. Ambiguous interrupted operations require manual review. A complete loss of extension storage cannot be reconstructed safely from desktop summary reports.
- This is a tested local beta, not a claim that all possible browser state and environmental failures are covered.
