// FILE LOCATION: backend/tests/helpers/tryOnFakes.js
// DESCRIPTION: In-memory stand-ins for the AI try-on persistence and provider
//              layers, so the job service can be driven without a database,
//              a disk or the network. The fake repository mirrors the SQL
//              repository's compare-and-set semantics (a transition only
//              lands from the statuses the real UPDATE ... WHERE allows); the
//              real SQL is exercised separately by tryOnJobRepository.test.js
//              against MySQL.

const ACTIVE = ['queued', 'processing'];

export const makeFakeRepo = ({ dailyLimitReached = false } = {}) => {
  const jobs = new Map();
  const calls = { credits: 0, inserts: [], deletes: 0 };
  const now = () => new Date();
  const later = (ms) => new Date(Date.now() + ms);

  const repo = {
    jobs,
    calls,
    async insert(row) {
      for (const j of jobs.values()) {
        if (j.userId === row.userId && j.idempotencyKey === row.idempotencyKey) {
          throw Object.assign(new Error('Duplicate entry'), { code: 'ER_DUP_ENTRY' });
        }
      }
      calls.inserts.push({ ...row });
      jobs.set(row.id, {
        id: row.id, userId: row.userId, productId: row.productId, vendorId: row.vendorId ?? null,
        provider: row.provider, providerJobId: null, idempotencyKey: row.idempotencyKey,
        status: 'queued', garmentCategory: row.garmentCategory, errorCode: null, resultKey: null,
        pollAttempts: 0, nextPollAt: null, consentAt: now(), createdAt: now(), updatedAt: now(),
        completedAt: null, deadlineAt: later(row.timeoutMinutes * 60_000), expiresAt: null,
      });
    },
    async findById(id) { return jobs.has(id) ? { ...jobs.get(id) } : null; },
    async findForUser(id, userId) {
      const j = jobs.get(id);
      return j && j.userId === userId ? { ...j } : null;
    },
    async findByIdempotencyKey(userId, key) {
      for (const j of jobs.values()) if (j.userId === userId && j.idempotencyKey === key) return { ...j };
      return null;
    },
    async findByProviderJob(provider, providerJobId) {
      for (const j of jobs.values()) if (j.provider === provider && j.providerJobId === providerJobId) return { ...j };
      return null;
    },
    async deleteUnsubmitted(id) {
      const j = jobs.get(id);
      if (j && j.status === 'queued' && !j.providerJobId) { jobs.delete(id); calls.deletes += 1; }
    },
    async countActive(userId = null) {
      let n = 0;
      for (const j of jobs.values()) {
        if (!ACTIVE.includes(j.status) || j.deadlineAt <= now()) continue;
        if (userId !== null && j.userId !== userId) continue;
        n += 1;
      }
      return n;
    },
    async markSubmitted(id, providerJobId, firstPollSeconds) {
      const j = jobs.get(id);
      if (!j || j.status !== 'queued') return false;
      Object.assign(j, { status: 'processing', providerJobId, nextPollAt: later(firstPollSeconds * 1000), updatedAt: now() });
      return true;
    },
    async claimPoll(id) {
      const j = jobs.get(id);
      if (!j || j.status !== 'processing') return false;
      if (j.nextPollAt && j.nextPollAt > now()) return false;
      j.pollAttempts += 1;
      j.nextPollAt = later(Math.min(30, 5 * 2 ** Math.min(j.pollAttempts - 1, 3)) * 1000);
      return true;
    },
    async markSucceeded(id, resultKey, ttlHours) {
      const j = jobs.get(id);
      if (!j || !ACTIVE.includes(j.status)) return false;
      Object.assign(j, { status: 'succeeded', resultKey, errorCode: null, completedAt: now(), expiresAt: later(ttlHours * 3_600_000), nextPollAt: null });
      return true;
    },
    async markEnded(id, status, errorCode) {
      const j = jobs.get(id);
      if (!j || !ACTIVE.includes(j.status)) return false;
      Object.assign(j, { status, errorCode, completedAt: now(), nextPollAt: null });
      return true;
    },
    async markResultExpired(id) {
      const j = jobs.get(id);
      if (!j || j.status !== 'succeeded') return false;
      Object.assign(j, { status: 'expired', errorCode: 'result_expired', resultKey: null });
      return true;
    },
    async listDuePolls() {
      return [...jobs.values()].filter((j) => j.status === 'processing' && (!j.nextPollAt || j.nextPollAt <= now()) && j.deadlineAt > now()).map((j) => ({ ...j }));
    },
    async listPastDeadline() {
      return [...jobs.values()].filter((j) => ACTIVE.includes(j.status) && j.deadlineAt <= now()).map((j) => ({ ...j }));
    },
    async listStaleQueued(olderThanSeconds) {
      const cutoff = Date.now() - olderThanSeconds * 1000;
      return [...jobs.values()].filter((j) => j.status === 'queued' && !j.providerJobId && j.createdAt.getTime() < cutoff).map((j) => ({ ...j }));
    },
    async listExpiredResults() {
      return [...jobs.values()].filter((j) => j.status === 'succeeded' && j.expiresAt && j.expiresAt <= now()).map((j) => ({ ...j }));
    },
    async liveResultIds(ids) {
      return new Set(ids.filter((id) => jobs.get(id)?.status === 'succeeded'));
    },
    async reserveDailyCredit() {
      calls.credits += 1;
      return !dailyLimitReached;
    },
    async purgeEnded() { return 0; },
  };
  return repo;
};

export const makeFakeStore = () => {
  const files = new Map();
  const calls = { puts: 0 };
  return {
    files,
    calls,
    async put(jobId, bytes) { calls.puts += 1; files.set(jobId, Buffer.from(bytes)); return `${jobId}.jpg`; },
    async read(jobId) { return files.get(jobId) || null; },
    async remove(jobId) { files.delete(jobId); },
    async sweep(isLive) {
      const live = await isLive([...files.keys()]);
      let n = 0;
      for (const id of [...files.keys()]) if (!live.has(id)) { files.delete(id); n += 1; }
      return n;
    },
  };
};

/**
 * Scripted provider implementing the adapter contract. `script` overrides
 * individual methods; every call is recorded.
 */
export const makeScriptedProvider = (script = {}) => {
  const calls = { submit: [], status: [], cancel: [], fetch: [] };
  let n = 0;
  const provider = {
    id: script.id || 'scripted',
    label: 'Scripted test provider',
    capabilities: {
      personImage: true,
      referenceGarmentImage: true,
      garmentCategories: ['upper_body', 'lower_body', 'dresses'],
      completion: ['poll', 'webhook'],
      maxInlineImageBytes: 2 * 1024 * 1024,
      ...(script.capabilities || {}),
    },
    verification: { inputSchemaVerified: true, commercialUseAllowed: true, licence: 'test' },
    calls,
    validateConfiguration: script.validateConfiguration || (() => []),
    mapGarmentCategory(c) { return this.capabilities.garmentCategories.includes(c) ? c : null; },
    async submitJob(input, config) {
      calls.submit.push(input);
      if (script.submitJob) return script.submitJob(input, config);
      n += 1;
      return { providerJobId: `prov-${n}`, status: 'queued', resultRef: null, errorCode: null };
    },
    async getJobStatus(id, config) {
      calls.status.push(id);
      if (script.getJobStatus) return script.getJobStatus(id, config);
      return { providerJobId: id, status: 'processing', resultRef: null, errorCode: null };
    },
    async cancelJob(id) { calls.cancel.push(id); if (script.cancelJob) return script.cancelJob(id); },
    async fetchResult(ref, config) {
      calls.fetch.push(ref);
      if (script.fetchResult) return script.fetchResult(ref, config);
      throw new Error('no result scripted');
    },
    verifyWebhook: script.verifyWebhook || (() => false),
    parseWebhook: script.parseWebhook || ((body) => body),
    classifyError: script.classifyError || ((err) => err?.tryOnCode || 'provider_unavailable'),
  };
  return provider;
};
