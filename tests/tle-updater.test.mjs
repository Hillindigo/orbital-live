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

test("retries temporary upstream failures before accepting a snapshot", async () => {
  const statuses = [500, 503, 200];
  const delays = [];
  const warnings = [];

  const updates = await downloadSnapshotUpdates({
    definitions: [definition],
    now: stationsMetadata.newestEpoch + 60 * 60 * 1000,
    maxAttempts: 3,
    retryBaseDelayMs: 100,
    sleepImpl: async (delay) => delays.push(delay),
    logger: { warn: (message) => warnings.push(message) },
    fetchImpl: async () => {
      const status = statuses.shift();
      return new Response(status === 200 ? stationsSnapshot : "temporary failure", {
        status,
      });
    },
  });

  assert.equal(updates.length, 1);
  assert.deepEqual(delays, [100, 200]);
  assert.equal(warnings.length, 2);
  assert.match(warnings[0], /HTTP 500.*attempt 1\/3.*retrying in 100ms/i);
  assert.match(warnings[1], /HTTP 503.*attempt 2\/3.*retrying in 200ms/i);
});

test("retries when reading a successful response body times out", async () => {
  let attempts = 0;
  const warnings = [];

  const updates = await downloadSnapshotUpdates({
    definitions: [definition],
    now: stationsMetadata.newestEpoch + 60 * 60 * 1000,
    maxAttempts: 2,
    retryBaseDelayMs: 0,
    sleepImpl: async () => {},
    logger: { warn: (message) => warnings.push(message) },
    fetchImpl: async () => {
      attempts += 1;
      if (attempts === 1) {
        return {
          ok: true,
          text: async () => {
            throw new DOMException("body timed out", "TimeoutError");
          },
        };
      }
      return new Response(stationsSnapshot, { status: 200 });
    },
  });

  assert.equal(attempts, 2);
  assert.equal(updates.length, 1);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /response body failed.*body timed out.*attempt 1\/2/i);
});

test("does not retry a permanent client error", async () => {
  let attempts = 0;

  await assert.rejects(
    downloadSnapshotUpdates({
      definitions: [definition],
      maxAttempts: 4,
      retryBaseDelayMs: 0,
      logger: { warn: () => assert.fail("permanent failures must not be retried") },
      fetchImpl: async () => {
        attempts += 1;
        return new Response("not found", { status: 404 });
      },
    }),
    /stations download failed with HTTP 404/i,
  );

  assert.equal(attempts, 1);
});

test("reports the attempt count after exhausting temporary failure retries", async () => {
  let attempts = 0;

  await assert.rejects(
    downloadSnapshotUpdates({
      definitions: [definition],
      maxAttempts: 3,
      retryBaseDelayMs: 0,
      logger: { warn: () => {} },
      fetchImpl: async () => {
        attempts += 1;
        return new Response("upstream unavailable", { status: 500 });
      },
    }),
    /stations download failed with HTTP 500 after 3 attempts/i,
  );

  assert.equal(attempts, 3);
});

test("keeps this repository's scheduled updater failure from triggering email", async () => {
  const workflow = await readFile(
    new URL("../.github/workflows/update-tle.yml", import.meta.url),
    "utf8",
  );

  assert.match(workflow, /schedule:/);
  assert.match(workflow, /continue-on-error:\s*true/);
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
