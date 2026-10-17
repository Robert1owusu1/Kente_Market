// FILE LOCATION: backend/Services/tryOn/providers/mockProvider.js
// DESCRIPTION: Development-only stand-in provider (AI_TRYON_PROVIDER=mock).
//              It does NOT generate a try-on: its "result" is the customer's
//              photo and the product image side by side under a banner that
//              says so, which is enough to exercise the whole journey (job
//              tracking, private result storage, UI states) without a paid
//              account. The registry refuses it when NODE_ENV=production.
import crypto from 'crypto';
import sharp from 'sharp';

const jobs = new Map(); // providerJobId -> { person, garment, polls }
const MAX_JOBS = 200;

const fromDataUri = (value) => Buffer.from(String(value).split(',')[1] || '', 'base64');

const mockProvider = {
  id: 'mock',
  label: 'Mock provider (development only — not AI)',
  capabilities: Object.freeze({
    personImage: true,
    referenceGarmentImage: true,
    garmentCategories: Object.freeze(['upper_body', 'lower_body', 'dresses']),
    completion: Object.freeze(['poll']),
    maxInlineImageBytes: 2 * 1024 * 1024,
  }),
  verification: Object.freeze({ inputSchemaVerified: true, commercialUseAllowed: false, licence: 'n/a (not a real provider)' }),

  validateConfiguration(config) {
    return config.production ? ['the mock provider cannot be used in production'] : [];
  },

  mapGarmentCategory(category) {
    return this.capabilities.garmentCategories.includes(category) ? category : null;
  },

  async submitJob(input) {
    if (!String(input.garmentImage).startsWith('data:')) {
      // Remote garment images are not fetched by the mock.
      const err = new Error('mock provider needs inline images');
      err.tryOnCode = 'provider_rejected_input';
      throw err;
    }
    const providerJobId = `mock-${crypto.randomUUID()}`;
    jobs.set(providerJobId, { person: input.personImage, garment: input.garmentImage, polls: 0 });
    while (jobs.size > MAX_JOBS) jobs.delete(jobs.keys().next().value);
    return { providerJobId, status: 'queued', resultRef: null, errorCode: null };
  },

  async getJobStatus(providerJobId) {
    const job = jobs.get(providerJobId);
    if (!job) return { providerJobId, status: 'failed', resultRef: null, errorCode: 'generation_failed' };
    job.polls += 1;
    if (job.polls < 2) return { providerJobId, status: 'processing', resultRef: null, errorCode: null };
    return { providerJobId, status: 'succeeded', resultRef: providerJobId, errorCode: null };
  },

  async cancelJob(providerJobId) {
    jobs.delete(providerJobId);
  },

  async fetchResult(resultRef) {
    const job = jobs.get(resultRef);
    if (!job) {
      const err = new Error('mock result gone');
      err.tryOnCode = 'result_unavailable';
      throw err;
    }
    jobs.delete(resultRef);
    const W = 384;
    const H = 512;
    const tile = (buf) => sharp(buf).resize(W, H, { fit: 'cover' }).jpeg().toBuffer();
    const banner = Buffer.from(
      `<svg width="${W * 2}" height="56"><rect width="100%" height="100%" fill="#b91c1c"/>`
      + '<text x="50%" y="36" font-size="22" font-family="sans-serif" fill="#fff" text-anchor="middle">'
      + 'TEST PROVIDER — NOT AN AI TRY-ON</text></svg>',
    );
    return sharp({ create: { width: W * 2, height: H + 56, channels: 3, background: '#ffffff' } })
      .composite([
        { input: banner, top: 0, left: 0 },
        { input: await tile(fromDataUri(job.person)), top: 56, left: 0 },
        { input: await tile(fromDataUri(job.garment)), top: 56, left: W },
      ])
      .jpeg()
      .toBuffer();
  },

  verifyWebhook() {
    return false;
  },
  parseWebhook() {
    return null;
  },
  classifyError(err) {
    return err?.tryOnCode || 'provider_unavailable';
  },
};

export default mockProvider;
