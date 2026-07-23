import { buildSaccoAuthHeaders } from './auth';

export class ApiError extends Error {
  status: number;
  details?: unknown;

  constructor(message: string, status: number, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
  }
}

export async function getSaccoAccessToken(fallbackToken = ''): Promise<string> {
  return fallbackToken;
}

export async function fetchSaccoJson<T>(url: string, init: RequestInit = {}, fallbackToken = ''): Promise<T> {
  const headers = new Headers(init.headers);
  const token = await getSaccoAccessToken(fallbackToken);
  if (!token) {
    throw new ApiError('Your session has ended. Sign in again.', 401);
  }

  Object.entries(buildSaccoAuthHeaders(token)).forEach(([key, value]) => {
    headers.set(key, value);
  });

  const response = await fetch(url, {
    ...init,
    headers
  });

  if (!response.ok) {
    let details: unknown;
    let message = `Request failed: ${response.status} ${response.statusText}`;

    try {
      details = await response.json();
      if (details && typeof details === 'object' && 'error' in details) {
        message = String((details as { error?: unknown }).error);
      }
    } catch {
      // Keep the generic response status message when the server returns no JSON body.
    }

    throw new ApiError(message, response.status, details);
  }

  return response.json() as Promise<T>;
}

export function postSaccoJson<TResponse, TPayload>(
  url: string,
  payload: TPayload,
  fallbackToken = ''
): Promise<TResponse> {
  return fetchSaccoJson<TResponse>(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  }, fallbackToken);
}
