// FILE LOCATION: backend/Services/tryOn/resultStore.js
// DESCRIPTION: Private storage for generated try-on images.
//
// Results are NOT written under backend/uploads (which is served publicly at
// /uploads) and are not given a public object-storage URL. They live in a
// private directory (default backend/private/tryon-results, override with
// AI_TRYON_RESULT_DIR) and are only ever streamed by the authenticated,
// owner-checked GET /api/tryon/jobs/:id/result.
//
// Files are named <jobId>.jpg; job ids are server-generated UUIDs, validated
// here again so no caller-influenced string can become a path. Writes go to a
// `.tmp` sibling and are renamed into place, so a crash never leaves a
// half-written result that looks complete; stale `.tmp` files are removed by
// the sweeper (Services/tryOn/tryOnJobService.js#sweepTryOnJobs).
//
// Limitation: this is the instance's local disk. On a host with an ephemeral
// filesystem (e.g. Render without a persistent disk) results disappear on
// redeploy, and they are not shared between instances. The job then reports
// `result_expired` — never someone else's image. See AI_TRYON_OPERATIONS.md.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getTryOnConfig } from './config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_DIR = path.join(__dirname, '..', '..', 'private', 'tryon-results');
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const TMP_MAX_AGE_MS = 10 * 60 * 1000;
const FRESH_RESULT_GRACE_MS = 2 * 60 * 1000;

export const resultDir = () => path.resolve(getTryOnConfig().resultDir || DEFAULT_DIR);

const fileFor = (jobId) => {
  if (!UUID_RE.test(String(jobId))) throw new Error('invalid try-on job id');
  return path.join(resultDir(), `${jobId}.jpg`);
};

const resultStore = {
  /** @returns {Promise<string>} the result key stored on the job row */
  async put(jobId, bytes) {
    const finalPath = fileFor(jobId);
    await fs.promises.mkdir(path.dirname(finalPath), { recursive: true, mode: 0o700 });
    const tmp = `${finalPath}.${process.pid}.${Date.now()}.tmp`;
    try {
      await fs.promises.writeFile(tmp, bytes, { mode: 0o600 });
      await fs.promises.rename(tmp, finalPath);
    } catch (err) {
      await fs.promises.unlink(tmp).catch(() => {});
      throw err;
    }
    return `${jobId}.jpg`;
  },

  /** @returns {Promise<Buffer|null>} null when the file is gone */
  async read(jobId) {
    try {
      return await fs.promises.readFile(fileFor(jobId));
    } catch (err) {
      if (err.code === 'ENOENT') return null;
      throw err;
    }
  },

  async remove(jobId) {
    await fs.promises.unlink(fileFor(jobId)).catch((err) => {
      if (err.code !== 'ENOENT') throw err;
    });
  },

  /**
   * Housekeeping: delete stale temp files, and result files whose job no
   * longer owns a live result (`isLive(ids)` -> Set of live ids).
   * @returns {Promise<number>} files removed
   */
  async sweep(isLive) {
    let entries;
    try {
      entries = await fs.promises.readdir(resultDir());
    } catch (err) {
      if (err.code === 'ENOENT') return 0;
      throw err;
    }
    let removed = 0;
    const now = Date.now();
    const resultIds = [];
    for (const name of entries) {
      const full = path.join(resultDir(), name);
      if (name.endsWith('.tmp')) {
        const stat = await fs.promises.stat(full).catch(() => null);
        if (stat && now - stat.mtimeMs > TMP_MAX_AGE_MS) {
          await fs.promises.unlink(full).catch(() => {});
          removed += 1;
        }
        continue;
      }
      const id = name.replace(/\.jpg$/, '');
      if (!name.endsWith('.jpg') || !UUID_RE.test(id)) continue;
      // A result is written just BEFORE its job row flips to succeeded; a
      // young file may simply not be committed yet.
      const stat = await fs.promises.stat(full).catch(() => null);
      if (stat && now - stat.mtimeMs > FRESH_RESULT_GRACE_MS) resultIds.push(id);
    }
    for (let i = 0; i < resultIds.length; i += 200) {
      const batch = resultIds.slice(i, i + 200);
      const live = await isLive(batch);
      for (const id of batch) {
        if (!live.has(id)) {
          await fs.promises.unlink(path.join(resultDir(), `${id}.jpg`)).catch(() => {});
          removed += 1;
        }
      }
    }
    return removed;
  },
};

export default resultStore;
