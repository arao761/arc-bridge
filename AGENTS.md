# Working on Arc Bridge

Build the working migration app described in docs/BUILD.md. Start by reading that file and docs/PROGRESS.md, then run npm test. The local folder belongs to the user; do not reset existing changes.

Make small commits after meaningful, tested milestones and push them to this private repository regularly when credentials permit. Use plain, specific messages such as "Keep tabs in their original profile". Use the configured Git author, current dates, and no co-author trailers. Do not manufacture history or hide limitations. A cloud workspace is separate from the user's Mac: never claim its changes are already on the Mac.

Use synthetic fixtures only. Do not request or upload real browser profiles, URLs, cookies, passwords, or system keychain material. Do not transmit browsing data to a server. Source browser data must remain unchanged. Do not write directly into live Firefox databases or session files. Real migration requires a preview and an explicit local confirmation, with isolated target profiles where appropriate.

Use a desktop shell plus a Firefox extension for browser operations; verify API capabilities at runtime. If tab groups are unavailable, use windows/bookmark folders and disclose the fallback. Profiles and containers are different; never merge authentication boundaries silently. Do not claim cookies, logins, extension settings, or complete browser state are transferred. Do not use UI automation against the user's actual browser during unattended development.

Follow official Arc export, Mozilla, Electron, and OpenAI documentation where relevant. Arc's on-disk formats are undocumented and must be treated as versioned adapters with unsupported-shape errors, not guessed recursive URL harvesting.

Tests must exercise parsing, profile isolation, URL validation, order/pinning, idempotence/retry and partial failure, rollback ownership, and behavior without Firefox group APIs. Keep stdout clean in native messaging; use length-prefixed framing and bound message sizes. Renderer code gets no Node access. Native messaging and local services must not expose arbitrary filesystem or command execution.

Maintain docs/PROGRESS.md with verified behavior, exact test commands, and remaining blockers. Run the production build and tests before handoff. Build a Linux-testable frontend and core in cloud, but do not claim Mac packaging, Arc format compatibility, Firefox profile migration or signing is verified unless tested. No paid infrastructure, public releases, or signing identities without user-supplied setup.
