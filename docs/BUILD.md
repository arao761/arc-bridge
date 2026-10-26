# Arc Bridge build brief

## Goal

A polished Mac-first desktop utility that previews and migrates Arc tabs, Favorites/pins, Spaces and folders into Firefox, keeping source profile boundaries intact. After initial permission and extension setup, the user chooses their mappings and presses Migrate. This is a real local migration utility, not a mock dashboard. Cloud development can continue while the Mac is asleep; the app itself operates locally when used.

## User flow

1. Launch the desktop app, choose an Arc export, and see which formats are actually supported. A synthetic example is available separately and visibly labeled.
2. Review profile/Space/folder hierarchy, tab counts, titles, URLs, and unsupported entries. Search, select subsets and optionally deduplicate within the same profile. Preserve repeated links across different profiles.
3. Detect Firefox and guide installation/pairing of the companion extension. Source browser reads are opt-in. Prefer official exported data; any optional direct source adapter must read a snapshot and never mutate Arc.
4. Map every Arc profile to an explicitly chosen Firefox profile. Map Spaces to named tab groups where the installed Firefox exposes the necessary APIs, otherwise separate windows. Preserve nested folder paths as bookmark folders. Containers must not be labeled as full profiles.
5. Preview the complete plan and warnings, then confirm migration. Firefox extension operations must run inside the intended Firefox profile; verify pairing/profile identity instead of attempting cross-profile extension access.
6. Show per-item progress and a completion report: migrated, skipped, failed, profile mappings, and any fidelity loss. Support cancel and safe retry/resume without duplicate creation.
7. Keep a portable JSON backup and an HTML bookmark fallback. An undo action removes only resources created by this migration, with explicit review and protection for user-modified resources.

## Scope and boundaries

- Import open/pinned tabs, Favorites, names, order, folder paths, Spaces, and profile associations when present in the selected format. Missing profile metadata must produce an explicit mapping step, not guessed account identity.
- Official Arc export availability is verified, but its exact current file schema has not been observed. Do not claim sample fixtures establish real-world export compatibility. Implement well-defined adapters with fixture provenance, sensible input limits, safe URL handling and clear unsupported-format errors. Seek public official examples; do not upload the user's data.
- Portable canonical archives are versioned. Existing core/archive.mjs is a starting contract, not a finished Arc importer. Evolve it carefully with tests.
- HTML bookmark import/export should use a real HTML parser and preserve hierarchy where the file provides it; flat link-list exports cannot reconstruct missing profiles or folder structures.
- Support HTTP/HTTPS URLs initially. Report browser-internal URLs, javascript/data/file URLs and missing URLs as unsupported. Never execute imported content or render it as unsanitized HTML.
- Password/history migration is a later optional guided flow using supported browser imports. No password CSV storage, cookie decryption, logged-in-session cloning, keychain access, or automatic extension/settings migration in version 1. The UI must disclose that websites may require sign-in again.
- The default path never uploads browsing data or contacts an LLM. Tab URLs are sensitive; logs should contain counts and opaque IDs rather than full URLs or content. Stored migration state should be private and removable.
- Do not edit Arc or Firefox profile databases directly. Create new isolated destination profiles through supported, verified mechanisms where available; guide manual creation if that is the reliable path. Never promise completely unattended first-run installation or profile provisioning.

## Proposed architecture

Use Electron with an isolated renderer and narrow preload IPC for file dialogs, bounded local reads and backups, with React/TypeScript/Vite or a comparably maintainable frontend. The cloud environment can implement/test the UI, normalization core, migration planner, Firefox extension and native host against mocks. Keep core parsing/planning independent of UI.

A companion Firefox WebExtension creates bookmarks/windows/tabs and tab groups after checking capabilities. Prefer native messaging for the local bridge. Use an allowlisted extension ID, strict message schema and size limits, per-install pairing, stable profile-specific receiver identity and explicit execution authorization. Do not expose an arbitrary HTTP bridge to web pages. If runtime communication is not feasible in the environment, deliver and verify an explicit migration-file import through the extension as a functional fallback, label the desktop pairing as incomplete, and document remaining work rather than pretending the bridge works.

Persist a migration journal keyed by archive fingerprint, source profile, and stable source item ID. Store created resource IDs and target profile identity. Check IDs before retries and rollback. Handle partial native/browser failures and app/browser restart. Open large sets in controlled batches and avoid eagerly loading hundreds of tabs where supported.

## Milestones and acceptance

1. Bootstrap core contract, fixture, planner tests, requirements and private repo. (Local foundation.)
2. Implement documented import adapters and bookmark fallback; malformed and unknown exports fail clearly.
3. Build polished preview and mapping UI with honest example mode, accessible keyboard controls, and substantive empty/error states.
4. Build companion extension and profile-specific import protocol; test order/pinning, unsupported capabilities, partial failures and duplicate-free retries.
5. Add journal, resume/cancel, progress/report, export and ownership-scoped undo.
6. Integrate desktop/native host and installation guidance. Package platform-independent assets in cloud and a Mac build workflow. Do not sign or publish a public release.
7. Run tests, production build, browser UI smoke checks if available, and simulated end-to-end tests. Report what is verified in cloud versus what requires a real Mac and Firefox. Commit and push coherent milestones regularly.

## References

- Arc export and sunset announcement: https://arc.net/
- Arc profile semantics: https://resources.arc.net/hc/en-us/articles/19227964556183-Profiles-Separate-Work-Personal-Browsing
- Firefox native messaging: https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Native_messaging
- Firefox tabs: https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/tabs
- Firefox tab groups: https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/tabGroups
- Firefox profiles: https://support.mozilla.org/en-US/kb/profile-management

## Cloud continuation

Repository: https://github.com/arao761/arc-bridge (private). Local checkout: /Users/ankitrao/Projects/arc-bridge. A cloud worker must check out the repository through the user's authorized GitHub connection; local CLI credentials must never be pasted into a task or committed. If access or a published cloud environment is unavailable, report the exact missing setup and preserve the work. Do not call a local/background process cloud execution.
