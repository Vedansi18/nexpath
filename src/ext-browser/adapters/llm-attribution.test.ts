import { describe, it, expect, beforeEach } from 'vitest';
import {
  NEXPATH_CLIENT_HEADER,
  NEXPATH_SURFACE_HEADER,
  NEXPATH_CLIENT_LABEL,
  NEXPATH_SURFACE_ENV,
  surfaceLabelForHostname,
  surfaceLabelForProjectRoot,
  applyLLMAttributionEnv,
  attributionHeadersFromEnv,
} from './llm-attribution.js';

type EnvHolder = { process?: { env?: Record<string, string | undefined> } };
function env(): Record<string, string | undefined> {
  const holder = globalThis as EnvHolder;
  holder.process ??= {};
  holder.process.env ??= {};
  return holder.process.env;
}

/** The service's `clean_label()` — a label outside this shape is stored as NULL there. */
const SERVICE_LABEL_SHAPE = /^[a-z0-9][a-z0-9._-]{0,31}$/;

describe('surfaceLabelForHostname — one word per supported site, nothing for anything else', () => {
  it('maps the three supported sites and their subdomains', () => {
    expect(surfaceLabelForHostname('replit.com')).toBe('replit');
    expect(surfaceLabelForHostname('abc-123.replit.com')).toBe('replit');
    expect(surfaceLabelForHostname('bolt.new')).toBe('bolt');
    expect(surfaceLabelForHostname('lovable.dev')).toBe('lovable');
  });

  it('reports stackblitz as its own label, not folded into bolt — that host has never been measured', () => {
    expect(surfaceLabelForHostname('stackblitz.com')).toBe('stackblitz');
    expect(surfaceLabelForHostname('w-corp.stackblitz.com')).toBe('stackblitz');
  });

  it('is exact on the apex — look-alike hosts get nothing', () => {
    expect(surfaceLabelForHostname('notreplit.com')).toBeUndefined();
    expect(surfaceLabelForHostname('lovable.dev.evil.example')).toBeUndefined();
    expect(surfaceLabelForHostname('bolt.new.example')).toBeUndefined();
    expect(surfaceLabelForHostname('api.openai.com')).toBeUndefined();
    expect(surfaceLabelForHostname('')).toBeUndefined();
  });

  it('is case- and whitespace-insensitive, since a hostname is', () => {
    expect(surfaceLabelForHostname(' REPLIT.COM ')).toBe('replit');
  });

  it('every label it can produce is one the service will keep', () => {
    for (const h of ['replit.com', 'bolt.new', 'stackblitz.com', 'lovable.dev']) {
      expect(surfaceLabelForHostname(h)).toMatch(SERVICE_LABEL_SHAPE);
    }
    expect(NEXPATH_CLIENT_LABEL).toMatch(SERVICE_LABEL_SHAPE);
  });
});

describe('surfaceLabelForProjectRoot — the per-project session root the pipelines already carry', () => {
  it('reads the host out of each supported project-root shape', () => {
    expect(surfaceLabelForProjectRoot('https://replit.com/@user/project')).toBe('replit');
    expect(surfaceLabelForProjectRoot('https://bolt.new/~/sb1-abc')).toBe('bolt');
    expect(surfaceLabelForProjectRoot('https://lovable.dev/projects/1e2d3c4b-0000-4000-8000-000000000000')).toBe('lovable');
  });

  it('never throws — null, empty and non-URL roots are simply "not known"', () => {
    expect(surfaceLabelForProjectRoot(null)).toBeUndefined();
    expect(surfaceLabelForProjectRoot(undefined)).toBeUndefined();
    expect(surfaceLabelForProjectRoot('')).toBeUndefined();
    expect(surfaceLabelForProjectRoot('not a url')).toBeUndefined();
    expect(surfaceLabelForProjectRoot('https://example.com/anything')).toBeUndefined();
  });
});

describe('applyLLMAttributionEnv / attributionHeadersFromEnv — the env seam the fetch adapter reads', () => {
  beforeEach(() => {
    delete env()[NEXPATH_SURFACE_ENV];
  });

  it('publishes the surface for a supported project root', () => {
    applyLLMAttributionEnv('https://replit.com/@u/p');
    expect(env()[NEXPATH_SURFACE_ENV]).toBe('replit');
    expect(attributionHeadersFromEnv()).toEqual({
      [NEXPATH_CLIENT_HEADER]: 'ext',
      [NEXPATH_SURFACE_HEADER]: 'replit',
    });
  });

  it('clears a stale surface when the next turn has no supported site — labels never outlive their turn', () => {
    applyLLMAttributionEnv('https://bolt.new/~/p');
    expect(env()[NEXPATH_SURFACE_ENV]).toBe('bolt');
    applyLLMAttributionEnv(null);
    expect(env()[NEXPATH_SURFACE_ENV]).toBeUndefined();
    expect(attributionHeadersFromEnv()).toEqual({ [NEXPATH_CLIENT_HEADER]: 'ext' });
  });

  it('the client label is unconditional; the surface header is omitted rather than sent empty', () => {
    expect(attributionHeadersFromEnv()).toEqual({ [NEXPATH_CLIENT_HEADER]: 'ext' });
    expect(NEXPATH_SURFACE_HEADER in attributionHeadersFromEnv()).toBe(false);
  });

  it('a malformed value planted in the env is not sent — the header can only ever carry a label', () => {
    env()[NEXPATH_SURFACE_ENV] = 'Bad Value!';
    expect(attributionHeadersFromEnv()).toEqual({ [NEXPATH_CLIENT_HEADER]: 'ext' });
    env()[NEXPATH_SURFACE_ENV] = 'https://replit.com/@u/p';
    expect(attributionHeadersFromEnv()).toEqual({ [NEXPATH_CLIENT_HEADER]: 'ext' });
  });

  it('the header names are the ones the service reads (router.py: x_nexpath_client / x_nexpath_surface)', () => {
    expect(NEXPATH_CLIENT_HEADER).toBe('X-Nexpath-Client');
    expect(NEXPATH_SURFACE_HEADER).toBe('X-Nexpath-Surface');
  });
});
