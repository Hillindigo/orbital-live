const ALLOWED_GROUPS = new Set(["starlink", "gps-ops", "stations"]);

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
    const fallback = await fetch(new URL(`/tle/${group}.tle`, request.url));
    return new Response(await fallback.text(), {
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "public, max-age=7200, s-maxage=7200, stale-while-revalidate=86400",
        "x-orbital-source": "bundled-snapshot",
        "x-orbital-fetched-at": new Date().toISOString(),
      },
    });
  }
}
