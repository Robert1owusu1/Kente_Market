// The service is the last line before a generated image reaches the screen:
// it must only ever report a job for the product it asked about, follow the
// server's real job status, and never leak the photo or provider details.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';

vi.mock('axios', async () => {
  const actual = await vi.importActual<typeof import('axios')>('axios');
  return { default: { ...actual.default, post: vi.fn(), get: vi.fn(), isAxiosError: actual.default.isAxiosError } };
});

const { default: tryOnService, TryOnRequestError, newIdempotencyKey } = await import('../api/tryOnService');
const post = vi.mocked(axios.post);
const get = vi.mocked(axios.get);
const PHOTO = 'data:image/jpeg;base64,UEhPVE8=';

const job = (over: Record<string, unknown> = {}) => ({
  jobId: 'job-1', productId: 11, status: 'processing', resultAvailable: false, expiresAt: null, error: null, ...over,
});
const httpError = (status: number, data: Record<string, unknown> = {}) =>
  new axios.AxiosError('fail', 'ERR', undefined, undefined, {
    status, data, statusText: '', headers: {}, config: {} as never,
  });

beforeEach(() => {
  post.mockReset();
  get.mockReset();
});

describe('tryOnService.createJob', () => {
  it('posts only the photo, the product id, consent and an idempotency key', async () => {
    post.mockResolvedValue({ data: { job: job() } });
    const r = await tryOnService.createJob(PHOTO, 11, 'key-12345678');
    expect(r.jobId).toBe('job-1');
    expect(post.mock.calls[0][0]).toMatch(/\/api\/tryon\/jobs$/);
    expect(post.mock.calls[0][1]).toEqual({ modelImage: PHOTO, productId: 11, consent: true, idempotencyKey: 'key-12345678' });
  });

  it('refuses a job attributed to a different product', async () => {
    post.mockResolvedValue({ data: { job: job({ productId: 12 }) } });
    await expect(tryOnService.createJob(PHOTO, 11, 'key-12345678')).rejects.toThrow(/did not match this product/);
  });

  it.each([
    [404, { message: 'That Kente cloth is not available for AI try-on.' }, /not available/],
    [422, { message: 'AI try-on is only available for Kente you wear.' }, /only available for Kente you wear/],
    [401, {}, /sign in/],
    [413, {}, /too large/],
    [429, { message: 'You have reached the daily limit of 5 try-ons.', code: 'daily_limit' }, /daily limit/],
    [503, { message: 'The AI stylist is unavailable right now. Please try again later.', code: 'provider_unavailable' }, /unavailable/],
    [502, { message: 'An error occurred' }, /had a problem/],
    [503, {}, /offline/],
  ])('maps HTTP %s to a clear message', async (status, data, expected) => {
    post.mockRejectedValue(httpError(status, data));
    const err = await tryOnService.createJob(PHOTO, 11, 'key-12345678').catch((e) => e);
    expect(err).toBeInstanceOf(TryOnRequestError);
    expect(err.message).toMatch(expected);
  });

  it('never logs the request payload (the photo)', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    post.mockRejectedValue(httpError(500, {}));
    await tryOnService.createJob(PHOTO, 11, 'key-12345678').catch(() => {});
    expect(JSON.stringify(spy.mock.calls)).not.toContain('UEhPVE8');
    spy.mockRestore();
  });
});

describe('tryOnService.waitForJob', () => {
  it('reports each real status until the job finishes', async () => {
    get
      .mockResolvedValueOnce({ data: { job: job({ status: 'processing' }) } })
      .mockResolvedValueOnce({ data: { job: job({ status: 'succeeded', resultAvailable: true }) } });
    const seen: string[] = [];
    const done = await tryOnService.waitForJob(job({ status: 'queued' }) as never, 11, (j) => seen.push(j.status), { intervalMs: 1 });
    expect(done.status).toBe('succeeded');
    expect(seen).toEqual(['processing', 'succeeded']);
    expect(get.mock.calls[0][0]).toMatch(/\/api\/tryon\/jobs\/job-1$/);
  });

  it('returns failed and expired jobs with their safe error', async () => {
    const error = { code: 'job_timeout', message: 'This try-on took too long and was stopped. Please try again.', retryable: true };
    get.mockResolvedValueOnce({ data: { job: job({ status: 'expired', error }) } });
    const done = await tryOnService.waitForJob(job() as never, 11, () => {}, { intervalMs: 1 });
    expect(done.status).toBe('expired');
    expect(done.error).toEqual(error);
  });

  it('refuses a status that names another product', async () => {
    get.mockResolvedValueOnce({ data: { job: job({ productId: 99 }) } });
    await expect(tryOnService.waitForJob(job() as never, 11, () => {}, { intervalMs: 1 })).rejects.toThrow(/did not match/);
  });

  it('stops polling when aborted and gives up after the backstop', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(tryOnService.waitForJob(job() as never, 11, () => {}, { signal: controller.signal, intervalMs: 1 }))
      .rejects.toThrow(/Aborted/);
    get.mockResolvedValue({ data: { job: job() } });
    await expect(tryOnService.waitForJob(job() as never, 11, () => {}, { intervalMs: 1, maxWaitMs: 5 }))
      .rejects.toThrow(/taking too long/);
  });
});

describe('tryOnService.getResultObjectUrl', () => {
  it('fetches the private result with credentials and returns a blob: URL', async () => {
    const create = vi.fn(() => 'blob:local/1');
    (URL as unknown as { createObjectURL: unknown }).createObjectURL = create;
    get.mockResolvedValue({ data: new Blob(['x'], { type: 'image/jpeg' }) });
    expect(await tryOnService.getResultObjectUrl('job-1')).toBe('blob:local/1');
    expect(get.mock.calls[0][0]).toMatch(/\/api\/tryon\/jobs\/job-1\/result$/);
    expect(get.mock.calls[0][1]).toMatchObject({ withCredentials: true, responseType: 'blob' });
  });

  it('reads the JSON message out of a blob error body (expired result)', async () => {
    const body = new Blob([JSON.stringify({ message: 'This try-on image has expired. Please create a new one.', code: 'result_expired' })]);
    get.mockRejectedValue(httpError(410, body as unknown as Record<string, unknown>));
    await expect(tryOnService.getResultObjectUrl('job-1')).rejects.toThrow(/expired/);
  });
});

describe('tryOnService.getProductEligibility', () => {
  it('asks the server about exactly that product', async () => {
    get.mockResolvedValue({ data: { productId: 11, enabled: true, eligible: true, reason: null } });
    await expect(tryOnService.getProductEligibility(11)).resolves.toMatchObject({ eligible: true });
    expect(get.mock.calls[0][0]).toMatch(/\/api\/tryon\/product\/11$/);
  });
});

describe('newIdempotencyKey', () => {
  it('is unique per attempt and matches the server format', () => {
    const a = newIdempotencyKey();
    const b = newIdempotencyKey();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
  });
});
