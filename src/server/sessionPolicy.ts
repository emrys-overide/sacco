export const SESSION_IDLE_TIMEOUT_MS = 60 * 60 * 1000;

export function isSessionIdle(lastActivityAt: string | undefined, now = Date.now()): boolean {
  if (!lastActivityAt) return false;
  const lastActivity = new Date(lastActivityAt).getTime();
  return !Number.isFinite(lastActivity) || now - lastActivity >= SESSION_IDLE_TIMEOUT_MS;
}
