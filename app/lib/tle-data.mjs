const HOUR_MS = 60 * 60 * 1000;

/**
 * @param {string} text
 * @returns {{ recordCount: number; oldestEpoch: number; newestEpoch: number }}
 */
export function parseTleMetadata(text) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const epochs = [];

  for (let index = 0; index + 2 < lines.length; index += 3) {
    const [, line1, line2] = lines.slice(index, index + 3);
    if (!line1.startsWith("1 ") || !line2.startsWith("2 ")) continue;

    const epoch = line1.slice(18, 32).trim();
    const shortYear = Number.parseInt(epoch.slice(0, 2), 10);
    const dayOfYear = Number.parseFloat(epoch.slice(2));
    if (
      !Number.isInteger(shortYear)
      || !Number.isFinite(dayOfYear)
      || dayOfYear < 1
      || dayOfYear >= 367
    ) {
      continue;
    }

    const year = shortYear >= 57 ? 1900 + shortYear : 2000 + shortYear;
    epochs.push(Date.UTC(year, 0, 1) + (dayOfYear - 1) * 86_400_000);
  }

  if (!epochs.length) {
    throw new Error("TLE response contains no valid TLE records");
  }

  return {
    recordCount: epochs.length,
    oldestEpoch: Math.min(...epochs),
    newestEpoch: Math.max(...epochs),
  };
}

/**
 * @param {string} text
 * @param {{
 *   group: string;
 *   minimumRecords: number;
 *   maximumEpochAgeHours?: number;
 *   now?: number;
 * }} options
 */
export function validateTleSnapshot(text, options) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length || lines.length % 3 !== 0) {
    throw new Error(`${options.group} contains incomplete three-line TLE records`);
  }

  const seenNoradIds = new Set();
  for (let index = 0; index < lines.length; index += 3) {
    const line1 = lines[index + 1];
    const line2 = lines[index + 2];
    if (!line1.startsWith("1 ") || !line2.startsWith("2 ")) {
      throw new Error(`${options.group} contains invalid three-line TLE records`);
    }
    if (line1.length < 69 || line2.length < 69) {
      throw new Error(`${options.group} contains truncated TLE lines`);
    }

    const line1Norad = line1.slice(2, 7);
    const line2Norad = line2.slice(2, 7);
    if (line1Norad !== line2Norad) {
      throw new Error(`${options.group} TLE NORAD IDs do not match`);
    }
    if (seenNoradIds.has(line1Norad)) {
      throw new Error(`${options.group} contains duplicate NORAD ID ${line1Norad}`);
    }
    seenNoradIds.add(line1Norad);

    if (!hasValidTleChecksum(line1) || !hasValidTleChecksum(line2)) {
      throw new Error(`${options.group} contains an invalid TLE checksum`);
    }
  }

  const metadata = parseTleMetadata(text);
  if (metadata.recordCount < options.minimumRecords) {
    throw new Error(
      `${options.group} TLE record count ${metadata.recordCount} is below ${options.minimumRecords}`,
    );
  }

  if (options.maximumEpochAgeHours !== undefined) {
    const now = options.now ?? Date.now();
    const ageHours = (now - metadata.newestEpoch) / HOUR_MS;
    if (ageHours > options.maximumEpochAgeHours) {
      throw new Error(
        `${options.group} TLE data is stale by ${ageHours.toFixed(1)} hours`,
      );
    }
    if (ageHours < -24) {
      throw new Error(
        `${options.group} TLE epoch is unexpectedly far in the future`,
      );
    }
  }

  return metadata;
}

/** @param {string} line */
function hasValidTleChecksum(line) {
  let sum = 0;
  for (let index = 0; index < 68; index += 1) {
    const character = line[index];
    if (character >= "0" && character <= "9") {
      sum += Number(character);
    } else if (character === "-") {
      sum += 1;
    }
  }
  return sum % 10 === Number(line[68]);
}
