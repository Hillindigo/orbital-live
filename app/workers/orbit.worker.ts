import {
  eciToEcf,
  eciToGeodetic,
  gstime,
  propagate,
  twoline2satrec,
  degreesLat,
  degreesLong,
  type SatRec,
  type EciVec3,
} from "satellite.js";

type OrbitRecord = {
  name: string;
  norad: string;
  group: string;
  line1: string;
  line2: string;
  satrec: SatRec;
  period: number;
  country: string;
  operator: string;
  launchYear: number | null;
  epochTime: number | null;
};

let records: OrbitRecord[] = [];
const EARTH_RADIUS = 6378.137;

function getOwnership(name: string, group: string) {
  const normalized = name.toUpperCase();
  if (normalized.includes("TIANGONG") || normalized.includes("TIANHE") || normalized.includes("WENTIAN") || normalized.includes("MENGTIAN") || normalized.includes("天宫")) {
    return { country: "中国", operator: "中国载人航天工程" };
  }
  if (group === "starlink" || group === "gps-ops") {
    return { country: "美国", operator: group === "starlink" ? "SpaceX" : "美国太空军" };
  }
  if (normalized.includes("ISS") || normalized.includes("ZARYA") || normalized.includes("NAUKA")) {
    return { country: "国际合作", operator: "NASA / ESA / Roscosmos / JAXA / CSA" };
  }
  return { country: "未标注", operator: "公开目录未提供" };
}

function getLaunchYear(line1: string) {
  const launchYear = Number.parseInt(line1.slice(9, 11), 10);
  if (!Number.isInteger(launchYear)) return null;
  return launchYear >= 57 ? 1900 + launchYear : 2000 + launchYear;
}

function getEpochTime(line1: string) {
  const epoch = line1.slice(18, 32).trim();
  const year = Number.parseInt(epoch.slice(0, 2), 10);
  const day = Number.parseFloat(epoch.slice(2));
  if (!Number.isInteger(year) || !Number.isFinite(day)) return null;
  const fullYear = year >= 57 ? 1900 + year : 2000 + year;
  return Date.UTC(fullYear, 0, 1) + (day - 1) * 86400000;
}

function parseTle(text: string, group: string): OrbitRecord[] {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const output: OrbitRecord[] = [];
  for (let index = 0; index + 2 < lines.length; index += 3) {
    const [name, line1, line2] = lines.slice(index, index + 3);
    if (!line1.startsWith("1 ") || !line2.startsWith("2 ")) continue;
    const meanMotion = Number.parseFloat(line2.slice(52, 63));
    const cleanName = name.replace(/^0 /, "").trim();
    const ownership = getOwnership(cleanName, group);
    output.push({
      name: cleanName,
      norad: line1.slice(2, 7).trim(),
      group,
      line1,
      line2,
      satrec: twoline2satrec(line1, line2),
      period: meanMotion > 0 ? 1440 / meanMotion : 0,
      ...ownership,
      launchYear: getLaunchYear(line1),
      epochTime: getEpochTime(line1),
    });
  }
  return output;
}

function calculate(record: OrbitRecord, date: Date) {
  const result = propagate(record.satrec, date);
  if (!result || !result.position || typeof result.position === "boolean") return null;
  const position = result.position as EciVec3<number>;
  const velocity = result.velocity && typeof result.velocity !== "boolean" ? result.velocity : null;
  const gmst = gstime(date);
  const ecf = eciToEcf(position, gmst);
  const geo = eciToGeodetic(position, gmst);
  return {
    x: ecf.x / EARTH_RADIUS,
    y: ecf.z / EARTH_RADIUS,
    z: -ecf.y / EARTH_RADIUS,
    latitude: degreesLat(geo.latitude),
    longitude: degreesLong(geo.longitude),
    altitude: geo.height,
    velocity: velocity ? Math.hypot(velocity.x, velocity.y, velocity.z) : 0,
  };
}

function calculateFrame(time: number, nextTime: number) {
  const now = new Float32Array(records.length * 3);
  const next = new Float32Array(records.length * 3);
  const telemetry = new Float32Array(records.length * 4);
  const nowDate = new Date(time);
  const nextDate = new Date(nextTime);

  records.forEach((record, index) => {
    const current = calculate(record, nowDate);
    const future = calculate(record, nextDate);
    const offset = index * 3;
    if (current) {
      now[offset] = current.x;
      now[offset + 1] = current.y;
      now[offset + 2] = current.z;
      telemetry[index * 4] = current.latitude;
      telemetry[index * 4 + 1] = current.longitude;
      telemetry[index * 4 + 2] = current.altitude;
      telemetry[index * 4 + 3] = current.velocity;
    }
    if (future) {
      next[offset] = future.x;
      next[offset + 1] = future.y;
      next[offset + 2] = future.z;
    }
  });

  self.postMessage(
    { type: "frame", time, nextTime, now, next, telemetry },
    { transfer: [now.buffer, next.buffer, telemetry.buffer] },
  );
}

function calculateOrbit(index: number, time: number) {
  const record = records[index];
  if (!record) return;
  const points = new Float32Array(181 * 3);
  const duration = record.period * 60 * 1000;
  for (let step = 0; step <= 180; step += 1) {
    const date = new Date(time + (duration * step) / 180);
    const position = calculate(record, date);
    if (!position) continue;
    points[step * 3] = position.x;
    points[step * 3 + 1] = position.y;
    points[step * 3 + 2] = position.z;
  }
  self.postMessage({ type: "orbit", index, points }, { transfer: [points.buffer] });
}

self.onmessage = (event: MessageEvent) => {
  const message = event.data;
  if (message.type === "load") {
    const seen = new Set<string>();
    records = message.groups.flatMap((entry: { group: string; text: string }) => parseTle(entry.text, entry.group))
      .filter((record: OrbitRecord) => {
        if (seen.has(record.norad)) return false;
        seen.add(record.norad);
        return true;
      });
    self.postMessage({
      type: "ready",
      satellites: records.map((record, index) => ({
        index,
        name: record.name,
        norad: record.norad,
        group: record.group,
        period: record.period,
        country: record.country,
        operator: record.operator,
        launchYear: record.launchYear,
        epochTime: record.epochTime,
      })),
    });
  } else if (message.type === "frame") {
    calculateFrame(message.time, message.nextTime);
  } else if (message.type === "orbit") {
    calculateOrbit(message.index, message.time);
  }
};
