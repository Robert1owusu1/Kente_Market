// FILE LOCATION: backend/Services/tryOn/tryOnJobService.js
// DESCRIPTION: AI try-on job lifecycle, provider-independent.
//
//   createTryOnJob   validate photo + product + consent -> idempotent insert
//                    -> capacity caps -> daily credit -> submit (ONE attempt)
//   getTryOnJobForUser   owner-only read; reconciles with the provider when a
//                        poll is due (claimPoll guarantees one poller)
//   readTryOnResult  owner-only bytes of a finished, unexpired result
//   handleTryOnWebhook   signature-verified, idempotent completion
//   sweepTryOnJobs   scheduled: due polls, deadlines, interrupted submits,
//                    result expiry, orphan/temp files, old metadata
//
// Product binding: the job row stores the productId/vendorId the SERVER
// resolved, and every response carries that productId. Nothing a provider
// returns can change it.
//
// Photo handling: the customer photo exists only as an in-memory buffer for
// the duration of createTryOnJob. It is never written to disk or the database
// and never logged. It is sent to the provider, which keeps it per its own
// retention policy (Replicate API: removed after 1 hour).
//
// Paid-call discipline: submitJob is called at most once per job and never
// retried automatically. Status reads and cancels are not generations.
import crypto from 'crypto';
import sharp from 'sharp';
import { AI_TRYON_DAILY_LIMIT } from '../../config/businessConfig.js';
import {
  sanitizeImageBuffer,
  decodeInlineDataUri,
  TryOnInputError,
} from '../../utils/tryOnImage.js';
import { resolveGarmentForTryOn } from './garment.js';
import { getProviderReadiness, getProviderById } from './providers/index.js';
import { getTryOnConfig } from './config.js';
import { TryOnServiceError, publicError } from './errors.js';
import defaultRepo from './jobRepository.js';
import defaultStore from './resultStore.js';

let repo = defaultRepo;
let store = defaultStore;
/** Tests swap in an in-memory repository / store. */
export const setTryOnPersistenceForTests = ({ repository, resultStore } = {}) => {
  repo = repository || defaultRepo;
  store = resultStore || defaultStore;
};

const IDEMPOTENCY_RE = /^[A-Za-z0-9_-]{8,64}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const FIRST_POLL_SECONDS = 5;
const STALE_QUEUED_SECONDS = 120;
const SWEEP_BATCH = 25;

/** Log without photo bytes, URLs or provider text: ids and codes only. */
const logEvent = (event, fields) => {
  console.log(JSON.stringify({ scope: 'ai-tryon', event, ...fields }));
};
const logError = (event, fields, err) => {
  console.error(JSON.stringify({
    scope: 'ai-tryon',
    event,
    ...fields,
    httpStatus: err?.response?.status ?? null,
    errCode: err?.code ?? null,
  }));
};

/** What the browser is allowed to see about a job. */
export const toPublicJob = (job) => ({
  jobId: job.id,
  productId: Number(job.productId),
  status: job.status,
  createdAt: job.createdAt,
  updatedAt: job.updatedAt,
  completedAt: job.completedAt ?? null,
  expiresAt: job.status === 'succeeded' ? job.expiresAt : null,
  resultAvailable: job.status === 'succeeded',
  error: publicError(job.errorCode),
});

/** Re-encode smaller until a data URI fits the provider's inline limit. */
const fitInline = async (dataUri, maxBytes) => {
  let buf = Buffer.from(dataUri.split(',')[1], 'base64');
  for (const edge of [1536, 1024, 768]) {
    if (buf.length <= maxBytes) break;
    buf = await sharp(buf).resize({ width: edge, height: edge, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 85 }).toBuffer();
  }
  if (buf.length > maxBytes) throw new TryOnInputError('This photo is too large to process. Please use a smaller photo.');
  return `data:image/jpeg;base64,${buf.toString('base64')}`;
};

const webhookUrlFor = (config, provider) =>
  config.webhookSecret && config.publicApiUrl && provider.capabilities.completion.includes('webhook')
    ? `${config.publicApiUrl}/api/tryon/webhooks/${encodeURIComponent(provider.id)}`
    : null;

/**
 * @param {{ userId: number, productId: unknown, modelImage: unknown,
 *           consent: unknown, idempotencyKey: unknown }} args
 * @returns {Promise<{ job: object, created: boolean }>}
 */
export const createTryOnJob = async ({ userId, productId, modelImage, consent, idempotencyKey }) => {
  const readiness = getProviderReadiness();
  if (!readiness.ready) {
    throw new TryOnServiceError(readiness.enabled ? 'provider_not_configured' : 'not_enabled');
  }
  const { provider, config } = readiness;

  if (consent !== true) {
    throw new TryOnInputError('Please confirm you agree to your photo being processed for this try-on.');
  }
  if (typeof idempotencyKey !== 'string' || !IDEMPOTENCY_RE.test(idempotencyKey)) {
    throw new TryOnInputError('idempotencyKey must be 8-64 letters, digits, "-" or "_"');
  }

  // A repeated submission (double click, network retry) gets the original
  // job back and spends nothing.
  const existing = await repo.findByIdempotencyKey(userId, idempotencyKey);
  if (existing) {
    if (Number(existing.productId) !== Number(productId)) {
      throw new TryOnInputError('This request id was already used for a different product.', 409);
    }
    return { job: existing, created: false };
  }

  // ---- Validate everything before anything is reserved or spent.
  if (typeof modelImage !== 'string' || !modelImage.startsWith('data:')) {
    throw new TryOnInputError('modelImage must be an uploaded photo (base64 data: URI), not a URL');
  }
  let personImage = (await sanitizeImageBuffer(decodeInlineDataUri(modelImage, 'modelImage'), 'modelImage')).dataUri;
  const garment = await resolveGarmentForTryOn(productId);
  const providerCategory = provider.mapGarmentCategory(garment.category);
  if (!providerCategory) {
    throw new TryOnInputError("AI try-on doesn't support this kind of garment yet.", 422);
  }
  const maxInline = provider.capabilities.maxInlineImageBytes;
  personImage = await fitInline(personImage, maxInline);
  const garmentImage = garment.image.startsWith('data:') ? await fitInline(garment.image, maxInline) : garment.image;

  // ---- Reserve: job row first (the idempotency key is unique), then caps,
  // ---- then the daily credit. Refusals before submit delete the row.
  const jobId = crypto.randomUUID();
  try {
    await repo.insert({
      id: jobId,
      userId,
      productId: garment.productId,
      vendorId: garment.vendorId,
      provider: provider.id,
      idempotencyKey,
      garmentCategory: providerCategory,
      timeoutMinutes: config.jobTimeoutMinutes,
    });
  } catch (err) {
    if (err?.code === 'ER_DUP_ENTRY') {
      const raced = await repo.findByIdempotencyKey(userId, idempotencyKey);
      if (raced) return { job: raced, created: false };
    }
    throw err;
  }

  const refuse = async (error) => {
    await repo.deleteUnsubmitted(jobId);
    throw error;
  };
  if ((await repo.countActive(userId)) > config.maxActivePerUser) {
    await refuse(new TryOnServiceError('capacity_user', {
      http: 429,
      message: 'You already have a try-on in progress. Please wait for it to finish.',
      retryAfterSeconds: 30,
    }));
  }
  if ((await repo.countActive()) > config.maxActiveGlobal) {
    await refuse(new TryOnServiceError('capacity_global', {
      http: 429,
      message: 'The AI stylist is at capacity right now. Please try again in a minute.',
      retryAfterSeconds: 60,
    }));
  }
  if (!(await repo.reserveDailyCredit(userId, AI_TRYON_DAILY_LIMIT))) {
    await refuse(new TryOnServiceError('daily_limit', {
      http: 429,
      message: `You have reached the daily limit of ${AI_TRYON_DAILY_LIMIT} try-ons. Please try again tomorrow.`,
    }));
  }

  // ---- Submit exactly once.
  let submitted;
  try {
    submitted = await provider.submitJob({
      personImage,
      garmentImage,
      garmentDescription: garment.name,
      garmentCategory: providerCategory,
      webhookUrl: webhookUrlFor(config, provider),
    }, config);
  } catch (err) {
    const code = provider.classifyError(err, 'submit');
    logError('submit_failed', { jobId, provider: provider.id, productId: garment.productId, code }, err);
    await repo.markEnded(jobId, 'failed', code);
    throw new TryOnServiceError(code);
  }
  personImage = null; // drop the only reference to the photo

  await repo.markSubmitted(jobId, submitted.providerJobId, FIRST_POLL_SECONDS);
  logEvent('submitted', { jobId, userId, productId: garment.productId, provider: provider.id });
  // The provider may answer a terminal state immediately.
  if (submitted.status !== 'queued' && submitted.status !== 'processing') {
    await applyProviderStatus(await repo.findById(jobId), submitted);
  }
  return { job: await repo.findById(jobId), created: true };
};

/**
 * Move a job to whatever the provider reports. Idempotent: every transition
 * is a CAS on the current status, so repeats (webhook retries, poll + webhook
 * racing) are no-ops once the job has ended.
 */
export const applyProviderStatus = async (job, providerState) => {
  if (!job || !['queued', 'processing'].includes(job.status) || !providerState) return job;
  const provider = getProviderById(job.provider);
  const { config } = getProviderReadiness();

  if (providerState.status === 'succeeded') {
    try {
      if (!providerState.resultRef) throw Object.assign(new Error('no output'), { tryOnCode: 'result_unavailable' });
      const raw = await provider.fetchResult(providerState.resultRef, config);
      // Never store or serve provider bytes as-is: decode + re-encode proves it
      // is an image and strips anything riding along.
      const { dataUri } = await sanitizeImageBuffer(raw, 'result');
      const key = await store.put(job.id, Buffer.from(dataUri.split(',')[1], 'base64'));
      const won = await repo.markSucceeded(job.id, key, config.resultTtlHours);
      if (!won) {
        const current = await repo.findById(job.id);
        if (current?.status !== 'succeeded') await store.remove(job.id);
      } else {
        logEvent('succeeded', { jobId: job.id, productId: Number(job.productId) });
      }
    } catch (err) {
      const code = err instanceof TryOnInputError ? 'result_unavailable' : provider.classifyError(err, 'result');
      logError('result_failed', { jobId: job.id, code }, err);
      // A transient download failure leaves the job processing so the next
      // poll retries the (free) download; anything else ends it.
      if (code !== 'provider_unavailable') await repo.markEnded(job.id, 'failed', 'result_unavailable');
    }
  } else if (providerState.status === 'failed') {
    await repo.markEnded(job.id, 'failed', providerState.errorCode || 'generation_failed');
    logEvent('failed', { jobId: job.id, code: providerState.errorCode || 'generation_failed' });
  } else if (providerState.status === 'canceled') {
    await repo.markEnded(job.id, 'canceled', 'canceled');
  }
  return repo.findById(job.id);
};

/** Poll the provider for one job if (and only if) this caller wins the claim. */
const reconcileJob = async (job) => {
  const provider = getProviderById(job.provider);
  if (!provider || !job.providerJobId) return job;
  if (!(await repo.claimPoll(job.id))) return job;
  try {
    const { config } = getProviderReadiness();
    const state = await provider.getJobStatus(job.providerJobId, config);
    return await applyProviderStatus(job, state);
  } catch (err) {
    // Status reads are free; a failure just waits for the next claim window.
    logError('status_failed', { jobId: job.id, code: provider.classifyError(err, 'status') }, err);
    return job;
  }
};

/** Stop a job that ran past its deadline. Cancel is best-effort, never retried. */
const expireJob = async (job) => {
  const ended = await repo.markEnded(job.id, 'expired', 'job_timeout');
  if (!ended) return;
  logEvent('timed_out', { jobId: job.id });
  const provider = getProviderById(job.provider);
  if (provider && job.providerJobId) {
    try {
      await provider.cancelJob(job.providerJobId, getProviderReadiness().config);
    } catch (err) {
      logError('cancel_failed', { jobId: job.id }, err);
    }
  }
};

const isPastDeadline = (job) => job.deadlineAt && new Date(job.deadlineAt).getTime() <= Date.now();

/** Owner-only job view; drives reconciliation while the customer is waiting. */
export const getTryOnJobForUser = async (jobId, userId) => {
  if (!UUID_RE.test(String(jobId))) throw new TryOnInputError('Try-on not found', 404);
  let job = await repo.findForUser(jobId, userId);
  // Another user's job answers exactly like a missing one.
  if (!job) throw new TryOnInputError('Try-on not found', 404);
  if (['queued', 'processing'].includes(job.status)) {
    if (isPastDeadline(job)) {
      await expireJob(job);
      job = await repo.findById(job.id);
    } else if (job.status === 'processing') {
      job = await reconcileJob(job);
    }
  }
  return job;
};

/** @returns {Promise<Buffer>} the stored result image for its owner */
export const readTryOnResult = async (jobId, userId) => {
  const job = await getTryOnJobForUser(jobId, userId);
  if (job.status === 'expired' && job.errorCode === 'result_expired') throw new TryOnServiceError('result_expired');
  if (job.status !== 'succeeded') throw new TryOnInputError('This try-on has no image yet.', 409);
  if (job.expiresAt && new Date(job.expiresAt).getTime() <= Date.now()) {
    await store.remove(job.id);
    await repo.markResultExpired(job.id);
    throw new TryOnServiceError('result_expired');
  }
  const bytes = await store.read(job.id);
  if (!bytes) {
    // Lost with the instance's disk: report it honestly, never substitute.
    await repo.markResultExpired(job.id);
    throw new TryOnServiceError('result_expired');
  }
  return bytes;
};

/**
 * Provider callback. Returns an HTTP status for the route; never reveals
 * whether a job exists.
 */
export const handleTryOnWebhook = async (providerId, rawBody, headers) => {
  const provider = getProviderById(providerId);
  const config = getTryOnConfig();
  if (!provider || !config.webhookSecret || !provider.capabilities.completion.includes('webhook')) return 404;
  if (!provider.verifyWebhook({ rawBody, headers, secret: config.webhookSecret })) {
    logEvent('webhook_rejected', { provider: providerId });
    return 401;
  }
  let body;
  try {
    body = JSON.parse(Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody));
  } catch {
    return 400;
  }
  const state = provider.parseWebhook(body);
  if (!state?.providerJobId) return 200;
  const job = await repo.findByProviderJob(provider.id, state.providerJobId);
  if (job) await applyProviderStatus(job, state);
  return 200;
};

/**
 * Scheduled housekeeping (cleanupJobs.js). Bounded per run.
 * @returns {Promise<number>} jobs/files touched
 */
export const sweepTryOnJobs = async () => {
  const config = getTryOnConfig();
  let touched = 0;

  // 1. Finish jobs whose webhook never came (or with polling-only providers).
  for (const job of await repo.listDuePolls(SWEEP_BATCH)) {
    await reconcileJob(job);
    touched += 1;
  }
  // 2. Deadlines.
  for (const job of await repo.listPastDeadline(SWEEP_BATCH)) {
    await expireJob(job);
    touched += 1;
  }
  // 3. Process died between "row inserted" and "provider accepted": we cannot
  //    know whether the provider started a run, and we must not resubmit.
  for (const job of await repo.listStaleQueued(STALE_QUEUED_SECONDS, SWEEP_BATCH)) {
    if (await repo.markEnded(job.id, 'failed', 'interrupted')) {
      logEvent('interrupted', { jobId: job.id });
      touched += 1;
    }
  }
  // 4. Result retention.
  for (const job of await repo.listExpiredResults(SWEEP_BATCH)) {
    await store.remove(job.id);
    if (await repo.markResultExpired(job.id)) touched += 1;
  }
  // 5. Orphaned and temporary files.
  touched += await store.sweep((ids) => repo.liveResultIds(ids));
  // 6. Photo-free metadata retention.
  touched += await repo.purgeEnded(config.jobRecordRetentionDays, 500);
  return touched;
};
