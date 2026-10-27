# Using Arc Bridge

Arc Bridge is a local Mac app for moving tab URLs and workspace organization into Firefox. It does not move logged-in sessions, passwords, cookies, extensions, or browser settings. You will generally need to sign in again.

## Install

Open the Apple Silicon DMG and drag Arc Bridge into Applications. This is an ad-hoc signed beta, not an Apple-notarized public release. Do not disable macOS security protections. A trusted public installer requires Apple Developer signing and notarization that are not configured here.

The current package requires macOS 13 or later. The companion requires desktop Firefox 142 or later. Firefox 158 was used for the isolated integration test.

## Connect Firefox once per profile

1. In Arc Bridge, open **Firefox receivers** and click **Install local bridge**. This installs an allowlisted native-messaging manifest in your user Library and a launcher backed by the app's bundled Electron runtime. You do not need Node or a terminal to use the installed application.
2. Click **Open companion folder**.
3. In the intended Firefox profile, open `about:debugging#/runtime/this-firefox`. Click **Load Temporary Add-on**, then select `manifest.json` from that folder.
4. Open the companion from Firefox's extensions menu, give the receiver a recognizable name, enable desktop migrations, and click **Save & connect**. Optional tab-group permission may be requested. Denying it uses separate windows instead.
5. Repeat in every distinct destination Firefox profile. If you need a new profile, create it through Firefox's profile manager first. The receiver name is a label for the current profile; it does not create or switch profiles. A container is not a substitute for a profile.

This beta companion is unsigned. Firefox temporary add-ons must be loaded again after the browser restarts. Migration journals are stored in the companion's local extension storage; do not uninstall the companion, clear its storage, or delete the Firefox profile while you still need resume or undo. If receiver identity or journal storage is lost, existing desktop records cannot reconstruct ownership safely. Previously addressed files are rejected by a different receiver. Persistent add-on installation requires Mozilla signing and is not configured here.

If you move the desktop app after installing the bridge, click **Reinstall bridge** to refresh its launcher path. Existing non-Arc Bridge native-messaging hosts are not changed.

## Choose and review your source

Use **Choose an Arc export** to select HTML, a portable Arc Bridge JSON archive, or a manually selected Arc `StorableSidebar.json` snapshot. The app reads only the file you choose, up to 20 MB and 20,000 tabs. It does not automatically scan your browser profiles or upload the export.

Arc's current export can be obtained through **Arc → Settings → Advanced → Export Data**. Its exact output may vary; the HTML adapter supports ordinary link lists and Netscape bookmark hierarchy. Unsupported JSON layouts fail explicitly. The sidebar adapter supports the alternating Space/item maps and pinned/unpinned roots described by public format investigations; this is experimental, not an official Arc API or a guarantee for all Arc versions. Live Arc data has not been inspected in development. See `BUILD.md` for source references and scope.

HTML and sidebar exports may omit authentication profile identity. Every top-level section starts isolated. In **Organize**, explicitly give sections the same source profile label only if you know they belong together. No profile is inferred from a site or account. Select the tabs you want; use search and expandable Spaces to inspect titles, URLs, paths and pin state.

The clearly labeled **Explore an example** uses synthetic data. It never represents imported personal data.

## Map and migrate

Map each source profile to a different enabled Firefox receiver. Spaces can become tab groups where Firefox APIs and permissions allow, or separate windows. Nested folder paths become bookmarks under a new migration-owned root. Firefox pins live outside tab groups. Split views become separate tabs, with their folder label preserved where available. Unpinned tabs are created discarded to avoid loading an entire workspace at once.

Review the plan, unsupported-link report, and mappings. Only HTTP/HTTPS URLs without embedded credentials are supported. Check the confirmation box, then choose **Migrate to Firefox**. Keep the receiver profiles open. The native bridge transfers the plan in bounded messages; it exposes no arbitrary command execution or network service.

The migration adds new browser resources; it does not merge or overwrite existing bookmarks. Existing Firefox data and the Arc source stay intact. Identical plans get stable IDs, so resuming an existing migration does not create another copy. Changing the plan or destination produces a different ID; review carefully before deliberately importing an overlapping new plan.

## Pause, resume and undo

**Migration history** shows per-profile progress and warnings. Pause stops between operations. Resume retries the same saved plan and skips already checkpointed items. The companion owns execution and journals, so closing the desktop window does not itself stop an already executing job. Pausing requires the receiver to be available to acknowledge the request.

New migrations attach extension-private ownership markers to tabs/windows so numeric IDs reused after restart cannot authorize deletion. Resume resolves restored windows by marker; ownership that cannot be verified stops safely. Legacy journals without markers preserve their tabs rather than trusting IDs.

Undo removes only tracked tabs and bookmarks whose URL, pin/window placement, title and parent information still match the relevant ownership checks. Modified or moved items are kept. A failed removal leaves undo retryable. Nonempty bookmark folders are kept. Resources created immediately before an interrupted journal checkpoint may be untracked; automatic replay pauses with **needs-review** rather than guessing and duplicating data. Undo then removes only known resources and reports that manual review may be needed. It is not a universal browser rollback.

Desktop report files contain IDs, receiver labels, counts and errors, not a full database backup. Export a portable archive separately. Receiver labels can still be personal, and migration files contain URLs; treat exported files as private.

## File transfer without the native bridge

Install the companion in the intended Firefox profile and copy its receiver ID. In Arc Bridge's mapping step, expand **Or use a migration file** and paste that ID. Review and export the profile-specific migration file.

In the companion popup, choose the file, review its tab count and listed URLs, confirm this is the correct profile and import. A receiver-ID mismatch is rejected. File transfers report their state inside the companion; they do not appear in desktop history unless queued through the native bridge.

## Portable backups and bookmark fallback

**Portable backup** writes a lossless versioned Arc Bridge archive for the selected inventory. **Bookmark HTML** writes an escaped, importable bookmark tree for all supported selected URLs. Import that HTML through Firefox's bookmark library. HTML preserves bookmarks and available hierarchy, but is not a full tab/session/profile backup and cannot recover metadata omitted by its source.

## Local files

The installed app uses `~/Library/Application Support/Arc Bridge` for approved job plans, receiver registrations, native-host launcher and reports. Those files stay local. Browser receiver IDs and detailed resource ownership journals are held by Firefox in `browser.storage.local` for the companion. No telemetry, model API, remote database or cloud account is used at runtime. Choose portable files and reports explicitly when you want a backup.

## Development

Use Node 24 and npm:

```sh
npm ci
npm test
npm run build
npm run lint:extension
npm run dev       # browser preview on 127.0.0.1:4321; no native bridge
npm run desktop   # build and launch Electron
npm run dist      # Apple Silicon DMG/ZIP on this Mac
npm run smoke     # isolated real Firefox + Electron integration test on macOS
```

The smoke test installs a uniquely named test native host and a temporary companion into a fresh WebDriver Firefox profile. It uses synthetic URLs served by a temporary loopback fixture server, and cleans up the host and temporary data. It does not automate or read your regular browser profiles. Selenium/Geckodriver and Playwright are development-only dependencies. The Firefox test harness is injected only into a temporary test extension copy and is never shipped.
