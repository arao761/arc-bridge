const LIMITS = { profiles: 50, spaces: 500, tabs: 20000, text: 4096 };
const text = (value, label) => {
  if (typeof value !== "string" || !value.trim() || value.length > LIMITS.text)
    throw new Error(
      `${label} must be a nonempty string under ${LIMITS.text} characters.`,
    );
  return value.trim();
};
const list = (value, label, max) => {
  if (!Array.isArray(value) || value.length > max)
    throw new Error(`Invalid ${label}.`);
  return value;
};

// This is the app's portable archive format, not an assertion about Arc's export format.
export function readArchive(value) {
  if (!value || value.format !== "arc-bridge" || value.version !== 1)
    throw new Error(
      "Unsupported archive. Choose a supported Arc export adapter or an Arc Bridge v1 archive.",
    );
  const ids = new Set();
  let tabs = 0;
  const unique = (value, label) => {
    const id = text(value, label);
    if (Object.hasOwn(Object.prototype, id))
      throw new Error("Reserved source ID.");
    if (ids.has(id)) throw new Error(`Duplicate source ID: ${id}`);
    ids.add(id);
    return id;
  };
  const profiles = list(value.profiles, "profiles", LIMITS.profiles).map(
    (profile) => ({
      id: unique(profile.id, "Profile ID"),
      name: text(profile.name, "Profile name"),
      spaces: list(profile.spaces, "spaces", LIMITS.spaces).map((space) => ({
        id: unique(space.id, "Space ID"),
        name: text(space.name, "Space name"),
        tabs: list(space.tabs, "tabs", LIMITS.tabs).map((tab) => {
          if (++tabs > LIMITS.tabs)
            throw new Error("Archive exceeds the 20,000-tab limit.");
          if (tab.pinned !== undefined && typeof tab.pinned !== "boolean")
            throw new Error("Invalid pinned state.");
          return {
            id: unique(tab.id, "Tab ID"),
            title: text(tab.title || tab.url, "Tab title"),
            url: text(tab.url, "Tab URL"),
            pinned: tab.pinned === true,
            folder: list(tab.folder || [], "folder path", 20).map((part) =>
              text(part, "Folder name"),
            ),
          };
        }),
      })),
    }),
  );
  return { format: "arc-bridge", version: 1, profiles };
}

export function buildPlan(archiveInput, mappings) {
  const archive = readArchive(archiveInput);
  const destinations = new Set();
  const operations = [];
  const skipped = [];
  for (const profile of archive.profiles) {
    const destination = mappings?.[profile.id];
    if (!destination || typeof destination !== "object")
      throw new Error(`Choose a Firefox profile for ${profile.name}.`);
    const targetProfileId = text(
      destination.profileId,
      "Destination profile ID",
    );
    if (destinations.has(targetProfileId))
      throw new Error("Source profiles must map to separate Firefox profiles.");
    destinations.add(targetProfileId);
    if (!["windows", "groups"].includes(destination.spaces))
      throw new Error("Choose windows or groups for Spaces.");
    for (const space of profile.spaces) {
      for (const tab of space.tabs) {
        let url;
        try {
          url = new URL(tab.url);
          if (
            !["http:", "https:"].includes(url.protocol) ||
            url.username ||
            url.password
          )
            throw new Error();
        } catch {
          skipped.push({
            sourceId: tab.id,
            profileId: profile.id,
            reason: "Unsupported URL or embedded credentials",
          });
          continue;
        }
        operations.push({
          sourceId: tab.id,
          sourceProfileId: profile.id,
          targetProfileId,
          spaceId: space.id,
          spaceName: space.name,
          spaceMode: destination.spaces,
          title: tab.title,
          url: url.href,
          pinned: tab.pinned,
          folder: [...tab.folder],
        });
      }
    }
  }
  return {
    version: 1,
    operations,
    skipped,
    warnings: [
      "Tab URLs and organization only: you may need to sign in again.",
      "Destination profile identity must be verified before executing this plan.",
    ],
  };
}
