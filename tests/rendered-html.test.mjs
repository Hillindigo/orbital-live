import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function loadWorker() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}-${Math.random()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker;
}

function environment() {
  return {
    ASSETS: {
      fetch: async (request) => {
        const url = new URL(request.url);
        if (url.pathname === "/tle/stations.tle") {
          return new Response("LOCAL TLE SNAPSHOT", {
            headers: { "content-type": "text/plain" },
          });
        }
        return new Response("Not found", { status: 404 });
      },
    },
  };
}

const context = {
  waitUntil() {},
  passThroughOnException() {},
};

test("server-renders the Orbital Live application shell", async () => {
  const worker = await loadWorker();
  const response = await worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    environment(),
    context,
  );

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<html lang="zh-CN">/);
  assert.match(html, /<title>Orbital Live/);
  assert.match(html, /ORBITAL/);
  assert.match(html, /Starlink/);
  assert.match(html, /GPS/);
  assert.match(html, /空间站/);
  assert.match(html, /正在加载三维地球/);
  assert.match(html, /SGP4 本地推算/);
  assert.doesNotMatch(html, /Your site is taking shape|Starter Project/);
});

test("rejects unsupported TLE groups before contacting CelesTrak", async () => {
  const worker = await loadWorker();
  const response = await worker.fetch(
    new Request("http://localhost/api/tle?group=unknown"),
    environment(),
    context,
  );

  assert.equal(response.status, 400);
  assert.equal(await response.text(), "Unsupported group");
});

test("rejects an invalid upstream payload and exposes snapshot epoch metadata", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("<html>upstream error page</html>", { status: 200 });

  try {
    const worker = await loadWorker();
    const response = await worker.fetch(
      new Request("http://localhost/api/tle?group=stations"),
      environment(),
      context,
    );

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("x-orbital-source"), "bundled-snapshot");
    assert.match(response.headers.get("x-orbital-tle-epoch-max") ?? "", /^20\d{2}-\d{2}-\d{2}T/);
    assert.match(response.headers.get("x-orbital-record-count") ?? "", /^\d+$/);
    assert.match(response.headers.get("x-orbital-served-at") ?? "", /^20\d{2}-\d{2}-\d{2}T/);
    assert.doesNotMatch(await response.text(), /upstream error page/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("keeps orbit metadata and fallback behavior explicit", async () => {
  const [worker, route, scene, page, groups, orbitTypes] = await Promise.all([
    readFile(new URL("../app/workers/orbit.worker.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/tle/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/components/GlobeSceneImpl.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/config/orbit-groups.json", import.meta.url), "utf8"),
    readFile(new URL("../app/lib/orbit-types.ts", import.meta.url), "utf8"),
  ]);

  assert.match(worker, /getEpochTime/);
  assert.match(worker, /epochTime: record\.epochTime/);
  assert.match(worker, /getOwnership/);
  assert.match(route, /x-orbital-source/);
  assert.match(route, /x-orbital-tle-epoch-max/);
  assert.match(route, /x-orbital-served-at/);
  assert.match(route, /bundled-snapshot/);
  assert.match(route, /AbortSignal\.timeout/);
  assert.match(route, /const forceRefresh = url\.searchParams\.has\("refresh"\)/);
  assert.match(route, /forceRefresh \? "no-store"/);
  assert.match(scene, /Promise\.allSettled/);
  assert.match(scene, /source: "failed"/);
  assert.match(scene, /reload: \(\) =>/);
  assert.match(scene, /refresh=\$\{Date\.now\(\)\}/);
  assert.match(scene, /cache: forceRefresh \? "no-store" : "default"/);
  assert.match(scene, /servedAt: servedAtValue \? Date\.parse\(servedAtValue\) : Date\.now\(\)/);
  assert.match(scene, /sizeAttenuation: false/);
  assert.match(scene, /points\.frustumCulled = false/);
  assert.match(scene, /makeSatelliteGlyphTexture/);
  assert.match(scene, /GROUP_MARKERS/);
  assert.match(groups, /"shape": "diamond"/);
  assert.match(groups, /"shape": "station"/);
  assert.match(groups, /"size": 8/);
  assert.match(orbitTypes, /setAutoRotate: \(enabled: boolean\) => void/);
  assert.match(scene, /const setAutoRotate = \(enabled: boolean\)/);
  assert.doesNotMatch(scene, /GPS_OVERVIEW_SCALE/);
  assert.doesNotMatch(scene, /visualScaleForGroup/);
  assert.match(scene, /WebGL 不可用/);
  assert.match(page, /event\.key === "r"/);
  assert.match(page, /type="range"/);
  assert.match(page, /timeline-range/);
  assert.match(page, /role="combobox"/);
  assert.match(page, /onDataStatus/);
  assert.match(page, /TLE 历元/);
  assert.match(page, /group-swatch \$\{group\.marker\.shape\}/);
  assert.match(page, /formatRefreshAge/);
  assert.match(page, /快照 TLE 历元/);
  assert.match(page, /orbital-ui-layout/);
  assert.match(page, /scene-controls/);
  assert.match(page, /panel-peek left/);
  assert.match(page, /setAutoRotate\(autoRotate\)/);
  assert.match(page, /const handleSatelliteSelect = useCallback/);
  assert.match(page, /onSelect=\{handleSatelliteSelect\}/);
});
