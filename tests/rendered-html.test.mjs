import assert from "node:assert/strict";
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
