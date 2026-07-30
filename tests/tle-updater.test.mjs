import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { parseTleMetadata } from "../app/lib/tle-data.mjs";
import {
  downloadSnapshotUpdates,
  writeSnapshotUpdates,
} from "../scripts/lib/tle-updater.mjs";

const stationsSnapshot = await readFile(
  new URL("../public/tle/stations.tle", import.meta.url),
  "utf8",
);
const stationsMetadata = parseTleMetadata(stationsSnapshot);
const normalizedStationsSnapshot = `${stationsSnapshot
  .trim()
  .split(/\r?\n/)
  .map((line) => line.trimEnd())
  .join("\n")}\n`;

const definition = {
  id: "stations",
  celestrakGroup: "stations",
  minimumRecords: 10,
  maximumEpochAgeHours: 96,
};

test("downloads and validates every configured CelesTrak group before writing", async () => {
  const requested = [];
  let activeRequests = 0;
  let maximumActiveRequests = 0;
  const newestEpoch = stationsMetadata.newestEpoch;
  const paddedSnapshot = stationsSnapshot.replace(/^([^\r\n]+)$/m, "$1   ");
  const updates = await downloadSnapshotUpdates({
    definitions: [
      definition,
      { ...definition, id: "stations-copy", celestrakGroup: "stations-copy" },
    ],
    now: newestEpoch + 60 * 60 * 1000,
    delayMs: 0,
    fetchImpl: async (url) => {
      requested.push(url);
      activeRequests += 1;
      maximumActiveRequests = Math.max(maximumActiveRequests, activeRequests);
      await new Promise((resolve) => setTimeout(resolve, 5));
      activeRequests -= 1;
      return new Response(paddedSnapshot, { status: 200 });
    },
  });

  assert.equal(
    requested[0],
    "https://celestrak.org/NORAD/elements/gp.php?GROUP=stations&FORMAT=tle",
  );
  assert.equal(updates[0].group, "stations");
  assert.equal(updates[0].recordCount, stationsMetadata.recordCount);
  assert.equal(updates[0].text, normalizedStationsSnapshot);
  assert.doesNotMatch(updates[0].text, / +$/m);
  assert.equal(updates.length, 2);
  assert.equal(maximumActiveRequests, 1);
});

test("writes validated snapshots to the public TLE directory", async () => {
  const root = await mkdtemp(join(tmpdir(), "orbital-tle-"));
  try {
    await writeSnapshotUpdates(
      [{
        group: "stations",
        text: stationsSnapshot,
        recordCount: stationsMetadata.recordCount,
        oldestEpoch: 0,
        newestEpoch: 0,
      }],
      root,
    );

    assert.equal(
      await readFile(join(root, "public", "tle", "stations.tle"), "utf8"),
      stationsSnapshot,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
