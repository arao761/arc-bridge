# Import adapter coverage

All fixtures committed here are synthetic. No real user export was accessed or uploaded during development.

## Portable archive v1

`core/archive.mjs` defines the app's own archive contract: profiles contain Spaces, and Spaces contain ordered tabs with URL, title, pin state and folder path. This is the lossless backup format for supported inventory. It is not Arc's native export schema.

## HTML / bookmark files

The HTML adapter uses parse5 to read ordinary anchor lists and Netscape bookmark folder structure. Headings and available hierarchy are preserved. Top-level sections begin isolated because HTML does not reliably establish profile identity. Group them only through the explicit source-profile labels in the preview. No browser account is inferred from a domain.

The official Arc announcement documents the Export Data menu but does not specify a stable file schema. Current HTML exports should be checked in the preview; an unknown JSON layout is rejected rather than treated as a recursively searchable bag of URLs.

Reference: https://arc.net/

## Experimental sidebar adapter

The adapter recognizes `sidebar.containers` with alternating Space/item maps, pinned/unpinned root references, saved tab URLs/titles, child IDs, lists and split views. It follows only supported roots. It does not reconstruct authentication profiles or guarantee all orphaned/archived records are meaningful current tabs. Counts and assignments must be reviewed before migrating.

The public data-shape investigation below informed the format checks. The implementation and fixtures in this repository were written independently; private Arc data was not used for compatibility verification. Arc can change this undocumented format.

Reference: https://gist.github.com/wargoblin/91add48695b2a6bf8b9cc91145844815

Favorites referenced by a supported container are kept as a separately assignable section. Split views become ordinary tabs. Unsupported items and missing references are warnings; empty or unrecognized layouts fail explicitly. If a file is not supported, use Arc's official export and the HTML adapter instead.
