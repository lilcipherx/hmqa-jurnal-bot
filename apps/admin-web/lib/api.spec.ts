import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  cookieGet: vi.fn(),
  forbidden: vi.fn(() => {
    throw new Error('NEXT_FORBIDDEN');
  }),
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));

vi.mock('next/headers', () => ({
  cookies: vi.fn(() => Promise.resolve({ get: mocks.cookieGet })),
}));
vi.mock('next/navigation', () => ({
  forbidden: mocks.forbidden,
  notFound: mocks.notFound,
}));

import { adminFetch } from './api';

describe('adminFetch authorization responses', () => {
  beforeEach(() => {
    vi.stubEnv('API_INTERNAL_URL', 'http://api.test:3001');
    mocks.cookieGet.mockReturnValue({ value: 'test-session' });
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('renders the framework 403 boundary for an authenticated forbidden response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(null, { status: 403 }))),
    );

    await expect(adminFetch('/api/v1/admin/submissions')).rejects.toThrow('NEXT_FORBIDDEN');
    expect(mocks.forbidden).toHaveBeenCalledOnce();
    expect(mocks.notFound).not.toHaveBeenCalled();
  });

  it('renders the framework not-found boundary for a missing resource', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(null, { status: 404 }))),
    );

    await expect(adminFetch('/api/v1/admin/submissions/missing')).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mocks.notFound).toHaveBeenCalledOnce();
    expect(mocks.forbidden).not.toHaveBeenCalled();
  });
});
