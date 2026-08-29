import {
  mkdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";

import { validateTleSnapshot } from "../../app/lib/tle-data.mjs";

const sleep = (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs));

function isRetryableStatus(status) {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

async function downloadSnapshot({
  definition,
  fetchImpl,
  maxAttempts,
  requestTimeoutMs,
  retryBaseDelayMs,
  retryMaximumDelayMs,
  sleepImpl,
  logger,
}) {
  const url = `https://celestrak.org/NORAD/elements/gp.php?GROUP=${encodeURIComponent(definition.celestrakGroup)}&FORMAT=tle`;
  const retryDelayFor = (attempt) => Math.min(
    retryBaseDelayMs * (2 ** (attempt - 1)),
    retryMaximumDelayMs,
  );

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let response;
    try {
      response = await fetchImpl(url, {
        headers: { "User-Agent": "Orbital-Live-Snapshot-Updater/1.0" },
        signal: AbortSignal.timeout(requestTimeoutMs),
      });
    } catch (error) {
      if (attempt === maxAttempts) {
        throw new Error(
          `${definition.id} download failed after ${maxAttempts} attempts: ${error.message}`,
          { cause: error },
        );
      }

      const retryDelay = retryDelayFor(attempt);
      logger.warn(
        `${definition.id} download failed (${error.message}), attempt ${attempt}/${maxAttempts}; retrying in ${retryDelay}ms`,
      );
      await sleepImpl(retryDelay);
      continue;
    }

    if (response.ok) {
      try {
        return await response.text();
      } catch (error) {
        if (attempt === maxAttempts) {
          throw new Error(
            `${definition.id} response body failed after ${maxAttempts} attempts: ${error.message}`,
            { cause: error },
          );
        }

        const retryDelay = retryDelayFor(attempt);
        logger.warn(
          `${definition.id} response body failed (${error.message}), attempt ${attempt}/${maxAttempts}; retrying in ${retryDelay}ms`,
        );
        await sleepImpl(retryDelay);
        continue;
      }
    }

    if (!isRetryableStatus(response.status) || attempt === maxAttempts) {
      if (attempt === maxAttempts && attempt > 1) {
        throw new Error(
          `${definition.id} download failed with HTTP ${response.status} after ${maxAttempts} attempts`,
        );
      }
      throw new Error(`${definition.id} download failed with HTTP ${response.status}`);
    }

    await response.body?.cancel();
    const retryDelay = retryDelayFor(attempt);
    logger.warn(
      `${definition.id} download failed with HTTP ${response.status}, attempt ${attempt}/${maxAttempts}; retrying in ${retryDelay}ms`,
    );
    await sleepImpl(retryDelay);
  }

  throw new Error(`${definition.id} download failed`);
}

/**
 * @param {{
 *   definitions: Array<{
 *     id: string;
 *     celestrakGroup: string;
 *     minimumRecords: number;
 *     maximumEpochAgeHours: number;
 *   }>;
 *   fetchImpl?: typeof fetch;
 *   now?: number;
 *   delayMs?: number;
 *   maxAttempts?: number;
 *   requestTimeoutMs?: number;
 *   retryBaseDelayMs?: number;
 *   retryMaximumDelayMs?: number;
 *   sleepImpl?: (delayMs: number) => Promise<void>;
 *   logger?: Pick<Console, "warn">;
 * }} options
 */
export async function downloadSnapshotUpdates({
  definitions,
  fetchImpl = fetch,
  now = Date.now(),
  delayMs = 1_000,
  maxAttempts = 4,
  requestTimeoutMs = 30_000,
  retryBaseDelayMs = 5_000,
  retryMaximumDelayMs = 30_000,
  sleepImpl = sleep,
  logger = console,
}) {
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new RangeError("maxAttempts must be a positive integer");
  }

  const updates = [];
  for (let index = 0; index < definitions.length; index += 1) {
    const definition = definitions[index];
    if (index > 0 && delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    const responseText = await downloadSnapshot({
      definition,
      fetchImpl,
      maxAttempts,
      requestTimeoutMs,
      retryBaseDelayMs,
      retryMaximumDelayMs,
      sleepImpl,
      logger,
    });
    const metadata = validateTleSnapshot(responseText, {
      group: definition.id,
      minimumRecords: definition.minimumRecords,
      maximumEpochAgeHours: definition.maximumEpochAgeHours,
      now,
    });

    const text = `${responseText
      .trim()
      .split(/\r?\n/)
      .map((line) => line.trimEnd())
      .join("\n")}\n`;

    updates.push({
      group: definition.id,
      text,
      ...metadata,
    });
  }
  return updates;
}

/**
 * Write only after every group has already downloaded and validated.
 *
 * @param {Array<{
 *   group: string;
 *   text: string;
 *   recordCount: number;
 *   oldestEpoch: number;
 *   newestEpoch: number;
 * }>} updates
 * @param {string} projectRoot
 */
export async function writeSnapshotUpdates(updates, projectRoot) {
  const directory = join(projectRoot, "public", "tle");
  await mkdir(directory, { recursive: true });

  const temporaryFiles = [];
  try {
    for (const update of updates) {
      const destination = join(directory, `${update.group}.tle`);
      const temporary = `${destination}.tmp-${process.pid}-${Date.now()}`;
      await writeFile(temporary, update.text, "utf8");
      temporaryFiles.push({ temporary, destination });
    }

    for (const { temporary, destination } of temporaryFiles) {
      await rename(temporary, destination);
    }
  } finally {
    await Promise.all(
      temporaryFiles.map(({ temporary }) => rm(temporary, { force: true })),
    );
  }
}
