import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import {
  downloadSnapshotUpdates,
  writeSnapshotUpdates,
} from "./lib/tle-updater.mjs";
import {
  parseTleMetadata,
  validateTleSnapshot,
} from "../app/lib/tle-data.mjs";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const definitions = JSON.parse(
  await readFile(new URL("../app/config/orbit-groups.json", import.meta.url), "utf8"),
);
const checkOnly = process.argv.includes("--check");

if (checkOnly) {
  for (const definition of definitions) {
    const text = await readFile(
      new URL(`../public/tle/${definition.id}.tle`, import.meta.url),
      "utf8",
    );
    const metadata = validateTleSnapshot(text, {
      group: definition.id,
      minimumRecords: definition.minimumRecords,
    });
    const ageHours = (Date.now() - metadata.newestEpoch) / 3_600_000;
    console.log(
      `${definition.id}: ${metadata.recordCount} records, newest ${new Date(metadata.newestEpoch).toISOString()}, age ${ageHours.toFixed(1)}h`,
    );
  }
} else {
  const updates = await downloadSnapshotUpdates({ definitions });
  await writeSnapshotUpdates(updates, projectRoot);
  for (const update of updates) {
    const metadata = parseTleMetadata(update.text);
    console.log(
      `${update.group}: wrote ${metadata.recordCount} records, newest ${new Date(metadata.newestEpoch).toISOString()}`,
    );
  }
}
