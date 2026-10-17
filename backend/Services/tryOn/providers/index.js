// FILE LOCATION: backend/Services/tryOn/providers/index.js
// DESCRIPTION: Provider registry + readiness check for AI try-on.
//
// ADAPTER CONTRACT (each provider module default-exports an object with):
//   id                  string, the AI_TRYON_PROVIDER value that selects it
//   label               human-readable name
//   capabilities        { personImage, referenceGarmentImage, garmentCategories[],
//                         completion: ('poll'|'webhook')[], maxInlineImageBytes }
//   verification        { inputSchemaVerified, commercialUseAllowed, licence }
//   validateConfiguration(config)            -> string[] problems (no secrets)
//   mapGarmentCategory(internalCategory)     -> provider value | null
//   submitJob(input, config)                 -> NormalisedJob
//       input: { personImage, garmentImage, garmentDescription,
//                garmentCategory, webhookUrl }
//   getJobStatus(providerJobId, config)      -> NormalisedJob
//   cancelJob(providerJobId, config)         -> void (best effort)
//   fetchResult(resultRef, config)           -> Buffer (image bytes)
//   verifyWebhook({ rawBody, headers, secret }) -> boolean
//   parseWebhook(body)                       -> NormalisedJob | null
//   classifyError(err, phase)                -> error code (see ../errors.js)
// NormalisedJob = { providerJobId, status: 'queued'|'processing'|'succeeded'|
//                   'failed'|'canceled', resultRef: string|null,
//                   errorCode: string|null }
// Adding a provider = one module implementing this, registered below, plus
// mocked tests. See AI_TRYON_PROVIDER_SETUP.md.
import { getTryOnConfig } from '../config.js';
import replicateIdmVton from './replicateIdmVton.js';
import mockProvider from './mockProvider.js';

const PROVIDERS = new Map([
  [replicateIdmVton.id, replicateIdmVton],
  [mockProvider.id, mockProvider],
]);

let testOverride = null;
/** Tests install a scripted adapter here; production code never calls it. */
export const setProviderForTests = (adapter) => { testOverride = adapter; };

export const listProviderIds = () => [...PROVIDERS.keys()];

/**
 * Is a provider configured well enough to accept NEW jobs?
 * @returns {{ enabled: boolean, ready: boolean, provider: object|null,
 *             config: ReturnType<typeof getTryOnConfig>, problems: string[] }}
 */
export const getProviderReadiness = () => {
  const config = getTryOnConfig();
  const problems = [];
  const provider = testOverride || PROVIDERS.get(config.providerId) || null;

  if (!config.enabled) problems.push('AI_TRYON_ENABLED is not "true"');
  if (!config.providerId && !testOverride) {
    problems.push(`AI_TRYON_PROVIDER is not set (one of: ${listProviderIds().join(', ')})`);
  } else if (!provider) {
    problems.push(`AI_TRYON_PROVIDER "${config.providerId}" is not a known provider`);
  }
  if (provider) {
    problems.push(...provider.validateConfiguration(config));
    if (!provider.capabilities?.personImage || !provider.capabilities?.referenceGarmentImage) {
      problems.push(`${provider.id} does not support person + reference-garment try-on`);
    }
    // A model whose licence does not allow commercial use cannot serve a
    // shop until the operator has obtained terms that do.
    if (config.production && !provider.verification?.commercialUseAllowed && !config.termsAccepted) {
      problems.push(
        `${provider.id}: licence is "${provider.verification?.licence}". Set AI_TRYON_PROVIDER_TERMS_ACCEPTED=true `
        + 'only after obtaining terms that permit commercial use',
      );
    }
    if (config.webhookSecret && !config.publicApiUrl) {
      problems.push('AI_TRYON_WEBHOOK_SECRET is set but AI_TRYON_PUBLIC_API_URL is not');
    }
    if (config.publicApiUrl && !/^https:\/\//.test(config.publicApiUrl) && config.production) {
      problems.push('AI_TRYON_PUBLIC_API_URL must be https in production');
    }
  }
  return {
    enabled: config.enabled,
    ready: problems.length === 0 && !!provider,
    provider,
    config,
    problems,
  };
};

/** The adapter that owns an existing job (status/webhook work continues even
 *  when new jobs are switched off). */
export const getProviderById = (id) => {
  if (testOverride && testOverride.id === id) return testOverride;
  return PROVIDERS.get(id) || null;
};
