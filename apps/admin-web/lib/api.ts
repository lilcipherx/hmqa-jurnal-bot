import { cookies } from 'next/headers';

function apiUrl(): string {
  const value = process.env.API_INTERNAL_URL;
  if (!value) throw new Error('API_INTERNAL_URL is required');
  return value.endsWith('/') ? value : `${value}/`;
}

export class AdminApiError extends Error {
  constructor(readonly status: number) {
    super(`ADMIN_API_${status}`);
  }
}

export async function adminFetch<T>(path: string): Promise<T> {
  const token = (await cookies()).get('hmqa_session')?.value;
  if (!token) throw new AdminApiError(401);
  const response = await fetch(new URL(path.replace(/^\//, ''), apiUrl()), {
    headers: { cookie: `hmqa_session=${encodeURIComponent(token)}` },
    cache: 'no-store',
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new AdminApiError(response.status);
  return response.json() as Promise<T>;
}

export interface CurrentEmployee {
  id: string;
  email: string;
  displayName: string;
  role: string;
  permissions: string[];
  journalIds: string[];
}

export function internalApiUrl(path: string): URL {
  return new URL(path.replace(/^\//, ''), apiUrl());
}
