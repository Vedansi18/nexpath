import { describe, expect, it } from 'vitest';
import { checkPromptEnhancementProviderApiAvailabilityV1 } from './provider-api-availability.js';

describe('provider-API availability — the runtime check flag 10 reads', () => {
  it('reports available when the client constructs (a key is present)', () => {
    const result = checkPromptEnhancementProviderApiAvailabilityV1(() => ({ chat: {} }));
    expect(result.providerApiAvailable).toBe(true);
    expect(result.reasonCode).toBe('provider_api_available');
  });

  it('reports key-missing when construction throws — the same signal the batch reads as no_key', () => {
    const result = checkPromptEnhancementProviderApiAvailabilityV1(() => { throw new Error('The OPENAI_API_KEY environment variable is missing'); });
    expect(result.providerApiAvailable).toBe(false);
    expect(result.reasonCode).toBe('provider_api_key_missing');
  });
});
