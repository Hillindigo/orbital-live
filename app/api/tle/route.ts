import gpsOpsSnapshot from "../../../public/tle/gps-ops.tle?raw";
import starlinkSnapshot from "../../../public/tle/starlink.tle?raw";
import stationsSnapshot from "../../../public/tle/stations.tle?raw";
import {
  ORBIT_GROUP_BY_ID,
  ORBIT_GROUP_IDS,
} from "../../lib/orbit-groups";
import {
  parseTleMetadata,
  validateTleSnapshot,
} from "../../lib/tle-data.mjs";

const SNAPSHOTS: Record<string, string> = {
  "gps-ops": gpsOpsSnapshot,
  starlink: starlinkSnapshot,
  stations: stationsSnapshot,
};

const ALLOWED_GROUPS = new Set(ORBIT_GROUP_IDS);
const UPSTREAM_TIMEOUT_MS = 8_000;

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
      "x-orbital-tle-epoch-min": new Date(metadata.oldestEpoch).toISOString(),
      "x-orbital-tle-epoch-max": new Date(metadata.newestEpoch).toISOString(),
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
  const definition = ORBIT_GROUP_BY_ID.get(group)!;

  try {
    const upstream = await fetch(
      `https://celestrak.org/NORAD/elements/gp.php?GROUP=${definition.celestrakGroup}&FORMAT=tle`,
      {
        headers: { "User-Agent": "Orbital-Live/1.0" },
        cache: forceRefresh ? "no-store" : "default",
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      },
    );
    if (!upstream.ok) throw new Error(`CelesTrak ${upstream.status}`);
    const text = await upstream.text();
    validateTleSnapshot(text, {
      group,
      minimumRecords: definition.minimumRecords,
      maximumEpochAgeHours: definition.maximumEpochAgeHours,
    });
    return tleResponse(text, "celestrak-live", forceRefresh);
  } catch {
    return tleResponse(SNAPSHOTS[group], "bundled-snapshot", forceRefresh);
  }
}
