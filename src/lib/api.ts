import type { User } from '../types';
import { buildSaccoAuthHeaders } from './auth';

export async function fetchSaccoJson<T>(url: string, user: User, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);

  Object.entries(buildSaccoAuthHeaders(user)).forEach(([key, value]) => {
    headers.set(key, value);
  });

  const response = await fetch(url, {
    ...init,
    headers
  });

  if (!response.ok) {
    throw new Error(`Request failed: ${response.status} ${response.statusText}`);
  }

  return response.json() as Promise<T>;
}

export function postSaccoJson<TResponse, TPayload>(
  url: string,
  user: User,
  payload: TPayload
): Promise<TResponse> {
  return fetchSaccoJson<TResponse>(url, user, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });
}
