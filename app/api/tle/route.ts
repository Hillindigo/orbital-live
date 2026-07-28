import gpsOpsSnapshot from "../../../public/tle/gps-ops.tle?raw";
import starlinkSnapshot from "../../../public/tle/starlink.tle?raw";
import stationsSnapshot from "../../../public/tle/stations.tle?raw";

const SNAPSHOTS: Record<string, string> = {
  "gps-ops": gpsOpsSnapshot,
  starlink: starlinkSnapshot,
  stations: stationsSnapshot,
};

const ALLOWED_GROUPS = new Set(Object.keys(SNAPSHOTS));
const UPSTREAM_TIMEOUT_MS = 8_000;

type TleMetadata = {
  recordCount: number;
  oldestEpoch: string;
  newestEpoch: string;
};

function parseTleMetadata(text: string): TleMetadata {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const epochs: number[] = [];

  for (let index = 0; index + 2 < lines.length; index += 3) {
    const [, line1, line2] = lines.slice(index, index + 3);
    if (!line1.startsWith("1 ") || !line2.startsWith("2 ")) continue;

    const epoch = line1.slice(18, 32).trim();
    const shortYear = Number.parseInt(epoch.slice(0, 2), 10);
    const dayOfYear = Number.parseFloat(epoch.slice(2));
    if (!Number.isInteger(shortYear) || !Number.isFinite(dayOfYear) || dayOfYear < 1 || dayOfYear > 367) continue;

    const year = shortYear >= 57 ? 1900 + shortYear : 2000 + shortYear;
    epochs.push(Date.UTC(year, 0, 1) + (dayOfYear - 1) * 86_400_000);
  }

  if (!epochs.length) throw new Error("TLE response contains no valid records");

  return {
    recordCount: epochs.length,
    oldestEpoch: new Date(Math.min(...epochs)).toISOString(),
    newestEpoch: new Date(Math.max(...epochs)).toISOString(),
  };
}

function tleResponse(text: string, source: "celestrak-live" | "bundled-snapshot", forceRefresh = false) {
  const metadata = parseTleMetadata(text);
  return new Response(text, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      // A normal page load may reuse TLE data briefly. A user-triggered refresh
      // must retry the upstream source instead of preserving an old snapshot.
      "cache-control": forceRefresh ? "no-store" : "public, max-age=300, s-maxage=300, stale-while-revalidate=3600",
      "x-orbital-source": source,
      "x-orbital-served-at": new Date().toISOString(),
      "x-orbital-tle-epoch-min": metadata.oldestEpoch,
      "x-orbital-tle-epoch-max": metadata.newestEpoch,
      "x-orbital-record-count": String(metadata.recordCount),
    },
  });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const group = url.searchParams.get("group") ?? "stations";
  const forceRefresh = url.searchParams.has("refresh");

  if (!ALLOWED_GROUPS.has(group)) {
    return new Response("Unsupported group", { status: 400 });
  }

  try {
    const upstream = await fetch(
      `https://celestrak.org/NORAD/elements/gp.php?GROUP=${group}&FORMAT=tle`,
      {
        headers: { "User-Agent": "Orbital-Live/1.0" },
        cache: forceRefresh ? "no-store" : "default",
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      },
    );
    if (!upstream.ok) throw new Error(`CelesTrak ${upstream.status}`);
    return tleResponse(await upstream.text(), "celestrak-live", forceRefresh);
  } catch {
    return tleResponse(SNAPSHOTS[group], "bundled-snapshot", forceRefresh);
  }
}
