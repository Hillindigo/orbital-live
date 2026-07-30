import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  parseTleMetadata,
  validateTleSnapshot,
} from "../app/lib/tle-data.mjs";
import {
  FOCUS_CAMERA_PADDING,
  OVERVIEW_MAX_DISTANCE,
  getFocusCameraDistance,
} from "../app/lib/orbit-camera.mjs";

const projectRoot = new URL("../", import.meta.url);

async function readProjectFile(path) {
  return readFile(new URL(path, projectRoot), "utf8");
}

test("defines every supported orbit group in one configuration file", async () => {
  const definitions = JSON.parse(
    await readProjectFile("app/config/orbit-groups.json"),
  );

  assert.deepEqual(
    definitions.map((group) => group.id),
    ["starlink", "gps-ops", "stations"],
  );
  definitions.forEach((group) => {
    assert.equal(typeof group.label, "string");
    assert.match(group.color, /^#[0-9a-f]{6}$/i);
    assert.ok(["circle", "diamond", "station"].includes(group.marker.shape));
    assert.ok(group.minimumRecords > 0);
    assert.ok(group.maximumEpochAgeHours >= 24);
    assert.equal("visualScale" in group, false);
  });
});

test("parses record count and epoch range from a real TLE snapshot", async () => {
  const text = await readProjectFile("public/tle/stations.tle");
  const metadata = parseTleMetadata(text);

  assert.ok(metadata.recordCount >= 10);
  assert.ok(metadata.oldestEpoch > 0);
  assert.ok(metadata.newestEpoch >= metadata.oldestEpoch);
});

test("rejects HTML, truncated groups, and stale upstream snapshots", async () => {
  const text = await readProjectFile("public/tle/stations.tle");
  const metadata = parseTleMetadata(text);

  assert.throws(
    () => validateTleSnapshot("<html>upstream error</html>", {
      group: "stations",
      minimumRecords: 1,
    }),
    /TLE records/i,
  );
  assert.throws(
    () => validateTleSnapshot(text, {
      group: "stations",
      minimumRecords: metadata.recordCount + 1,
    }),
    /record count/i,
  );
  assert.throws(
    () => validateTleSnapshot(text, {
      group: "stations",
      minimumRecords: 1,
      maximumEpochAgeHours: 48,
      now: metadata.newestEpoch + 49 * 60 * 60 * 1000,
    }),
    /stale/i,
  );
});

test("rejects mismatched, duplicate, and checksum-invalid TLE records", async () => {
  const text = await readProjectFile("public/tle/stations.tle");
  const lines = text.trim().split(/\r?\n/);
  const firstRecord = lines.slice(0, 3);

  const mismatched = [...firstRecord];
  mismatched[2] = `${mismatched[2].slice(0, 2)}99999${mismatched[2].slice(7)}`;
  assert.throws(
    () => validateTleSnapshot(`${mismatched.join("\n")}\n`, {
      group: "stations",
      minimumRecords: 1,
    }),
    /NORAD IDs do not match/i,
  );

  assert.throws(
    () => validateTleSnapshot(`${firstRecord.concat(firstRecord).join("\n")}\n`, {
      group: "stations",
      minimumRecords: 1,
    }),
    /duplicate NORAD ID/i,
  );

  const invalidChecksum = [...firstRecord];
  invalidChecksum[1] = `${invalidChecksum[1].slice(0, 68)}${invalidChecksum[1][68] === "0" ? "1" : "0"}`;
  assert.throws(
    () => validateTleSnapshot(`${invalidChecksum.join("\n")}\n`, {
      group: "stations",
      minimumRecords: 1,
    }),
    /checksum/i,
  );
});

test("keeps every satellite group at its physical orbital radius", async () => {
  const scene = await readProjectFile("app/components/GlobeSceneImpl.tsx");

  assert.doesNotMatch(scene, /GPS_OVERVIEW_SCALE/);
  assert.doesNotMatch(scene, /visualScaleForGroup/);
});

test("allows the camera to frame the complete physical GPS orbit", () => {
  const gpsOrbitalRadius = 4.2;

  assert.ok(OVERVIEW_MAX_DISTANCE >= 14);
  assert.ok(
    getFocusCameraDistance(gpsOrbitalRadius)
      >= gpsOrbitalRadius + FOCUS_CAMERA_PADDING,
  );
  assert.equal(getFocusCameraDistance(1.1), 2.7);
});

test("provides scheduled PR-based snapshot maintenance without direct deployment", async () => {
  const workflow = await readProjectFile(".github/workflows/update-tle.yml");

  assert.match(workflow, /schedule:/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /npm run tle:update/);
  assert.match(workflow, /npm run verify/);
  assert.match(workflow, /gh pr create/);
  assert.doesNotMatch(workflow, /deploy:cloudflare/);
});

test("gates Cloudflare production deployment behind verification and repository credentials", async () => {
  const workflow = await readProjectFile(
    ".github/workflows/deploy-cloudflare.yml",
  );

  assert.match(workflow, /pull_request:[\s\S]*?branches:[\s\S]*?- main/);
  assert.match(workflow, /push:[\s\S]*?branches:[\s\S]*?- main/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /npm run lint/);
  assert.match(workflow, /npm run typecheck/);
  assert.match(workflow, /npm test/);
  assert.match(workflow, /needs: verify/);
  assert.match(workflow, /actions\/upload-artifact@v4/);
  assert.match(workflow, /actions\/download-artifact@v4/);
  assert.match(workflow, /secrets\.CLOUDFLARE_API_TOKEN/);
  assert.match(workflow, /vars\.CLOUDFLARE_ACCOUNT_ID/);
  assert.match(
    workflow,
    /npx wrangler deploy --config dist\/server\/wrangler\.json/,
  );
  assert.match(workflow, /Smoke-test production/);
  assert.match(workflow, /\/api\/tle\?group=stations/);
  assert.doesNotMatch(workflow, /1ab3dcd70862417f8f38862c2b15f894/);
});

test("tracks the Sites build plugin required by Vite and CI", async () => {
  const gitignore = await readProjectFile(".gitignore");
  const plugin = await readProjectFile("build/sites-vite-plugin.ts");

  assert.match(gitignore, /^build\/\*$/m);
  assert.match(gitignore, /^!build\/sites-vite-plugin\.ts$/m);
  assert.match(plugin, /export function sites\(\): Plugin/);
});
