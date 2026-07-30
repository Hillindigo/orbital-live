import {
  mkdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";

import { validateTleSnapshot } from "../../app/lib/tle-data.mjs";

/**
 * @param {{
 *   definitions: Array<{
 *     id: string;
 *     celestrakGroup: string;
 *     minimumRecords: number;
 *     maximumEpochAgeHours: number;
 *   }>;
 *   fetchImpl?: typeof fetch;
 *   now?: number;
 *   delayMs?: number;
 * }} options
 */
export async function downloadSnapshotUpdates({
  definitions,
  fetchImpl = fetch,
  now = Date.now(),
  delayMs = 1_000,
}) {
  const updates = [];
  for (let index = 0; index < definitions.length; index += 1) {
    const definition = definitions[index];
    if (index > 0 && delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    const url = `https://celestrak.org/NORAD/elements/gp.php?GROUP=${encodeURIComponent(definition.celestrakGroup)}&FORMAT=tle`;
    const response = await fetchImpl(url, {
      headers: { "User-Agent": "Orbital-Live-Snapshot-Updater/1.0" },
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      throw new Error(`${definition.id} download failed with HTTP ${response.status}`);
    }

    const responseText = await response.text();
    const metadata = validateTleSnapshot(responseText, {
      group: definition.id,
      minimumRecords: definition.minimumRecords,
      maximumEpochAgeHours: definition.maximumEpochAgeHours,
      now,
    });

    const text = `${responseText
      .trim()
      .split(/\r?\n/)
      .map((line) => line.trimEnd())
      .join("\n")}\n`;

    updates.push({
      group: definition.id,
      text,
      ...metadata,
    });
  }
  return updates;
}

/**
 * Write only after every group has already downloaded and validated.
 *
 * @param {Array<{
 *   group: string;
 *   text: string;
 *   recordCount: number;
 *   oldestEpoch: number;
 *   newestEpoch: number;
 * }>} updates
 * @param {string} projectRoot
 */
export async function writeSnapshotUpdates(updates, projectRoot) {
  const directory = join(projectRoot, "public", "tle");
  await mkdir(directory, { recursive: true });

  const temporaryFiles = [];
  try {
    for (const update of updates) {
      const destination = join(directory, `${update.group}.tle`);
      const temporary = `${destination}.tmp-${process.pid}-${Date.now()}`;
      await writeFile(temporary, update.text, "utf8");
      temporaryFiles.push({ temporary, destination });
    }

    for (const { temporary, destination } of temporaryFiles) {
      await rename(temporary, destination);
    }
  } finally {
    await Promise.all(
      temporaryFiles.map(({ temporary }) => rm(temporary, { force: true })),
    );
  }
}
