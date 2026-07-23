import gpsOpsSnapshot from "../../../public/tle/gps-ops.tle?raw";
import starlinkSnapshot from "../../../public/tle/starlink.tle?raw";
import stationsSnapshot from "../../../public/tle/stations.tle?raw";

const SNAPSHOTS: Record<string, string> = {
  "gps-ops": gpsOpsSnapshot,
  starlink: starlinkSnapshot,
  stations: stationsSnapshot,
};

const ALLOWED_GROUPS = new Set(Object.keys(SNAPSHOTS));

export async function GET(request: Request) {
  const url = new URL(request.url);
  const group = url.searchParams.get("group") ?? "stations";

  if (!ALLOWED_GROUPS.has(group)) {
    return new Response("Unsupported group", { status: 400 });
  }

  try {
    const upstream = await fetch(
      `https://celestrak.org/NORAD/elements/gp.php?GROUP=${group}&FORMAT=tle`,
      { headers: { "User-Agent": "Orbital-Live/1.0" } },
    );
    if (!upstream.ok) throw new Error(`CelesTrak ${upstream.status}`);
    return new Response(await upstream.text(), {
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "public, max-age=7200, s-maxage=7200, stale-while-revalidate=86400",
        "x-orbital-source": "celestrak-live",
        "x-orbital-fetched-at": new Date().toISOString(),
      },
    });
  } catch {
    return new Response(SNAPSHOTS[group], {
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "public, max-age=7200, s-maxage=7200, stale-while-revalidate=86400",
        "x-orbital-source": "bundled-snapshot",
        "x-orbital-fetched-at": new Date().toISOString(),
      },
    });
  }
}
