/** Utilities shared by the private developer error log and its tests. */

export function configuredDeveloperEmails(value = process.env.DEVELOPER_ERROR_LOG_EMAILS || ''): string[] {
  return [...new Set(value.split(',').map(email => email.trim().toLowerCase()).filter(Boolean))];
}

export function canViewDeveloperErrorLog(email: string | undefined, configuredEmails = process.env.DEVELOPER_ERROR_LOG_EMAILS || ''): boolean {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  return Boolean(normalizedEmail && configuredDeveloperEmails(configuredEmails).includes(normalizedEmail));
}

/** Remove common credentials before an error is persisted or shown in the developer UI. */
export function redactErrorText(value: unknown, maxLength = 8_000): string {
  return String(value || '')
    .replace(/(authorization\s*[:=]\s*(?:bearer\s+)?)\S+/gi, '$1[REDACTED]')
    .replace(/(password|token|secret|api[_-]?key|cookie)\s*[:=]\s*[^\s,;)}\]]+/gi, '$1=[REDACTED]')
    .replace(/\beyJ[a-zA-Z0-9_-]{8,}\.[a-zA-Z0-9_-]{8,}\.[a-zA-Z0-9_-]{8,}\b/g, '[REDACTED_JWT]')
    .slice(0, maxLength);
}

/** Query strings often contain identifiers or reset codes, so never persist them. */
export function safeErrorPath(value: unknown): string {
  const raw = String(value || '/').trim();
  const path = raw.split('?')[0].split('#')[0] || '/';
  return path.startsWith('/') ? path.slice(0, 500) : '/';
}
