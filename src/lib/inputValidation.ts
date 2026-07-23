const personNameCharacters = /[^\p{L}\s.'-]/gu;

/** Names may contain letters, spaces, apostrophes, periods, and hyphens. */
export function sanitizePersonName(value: unknown): string {
  return String(value ?? '')
    .replace(personNameCharacters, '')
    .replace(/\s{2,}/g, ' ');
}

export function isValidPersonName(value: unknown): boolean {
  const name = String(value ?? '').trim();
  return /^(?=.*\p{L})[\p{L}.' -]+$/u.test(name);
}

/** Keeps a phone number numeric while allowing one leading international +. */
export function sanitizePhoneNumber(value: unknown): string {
  const raw = String(value ?? '');
  const digits = raw.replace(/\D/g, '').slice(0, 15);
  return raw.trim().startsWith('+') && digits ? `+${digits}` : digits;
}

export function isValidPhoneNumber(value: unknown): boolean {
  const digits = String(value ?? '').replace(/\D/g, '');
  return digits.length >= 9 && digits.length <= 15;
}

/** National IDs, paybills, and MSISDNs are digit-only fields. */
export function sanitizeIntegerInput(value: unknown, maxLength?: number): string {
  const digits = String(value ?? '').replace(/\D/g, '');
  return maxLength ? digits.slice(0, maxLength) : digits;
}

/** Amounts accept digits and a single decimal separator only. */
export function sanitizeDecimalInput(value: unknown): string {
  const cleaned = String(value ?? '').replace(/[^\d.]/g, '');
  const [whole = '', ...fractionParts] = cleaned.split('.');
  return fractionParts.length ? `${whole}.${fractionParts.join('')}` : whole;
}

/** Vehicle registration is deliberately alphanumeric, with spaces between groups. */
export function sanitizeVehiclePlate(value: unknown): string {
  return String(value ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, '')
    .replace(/\s{2,}/g, ' ');
}

export function isValidKenyanVehiclePlate(value: unknown): boolean {
  return /^K[A-D][A-Z]\s?\d{3}[A-Z]$/.test(sanitizeVehiclePlate(value).trim());
}

/** Payment and audit references deliberately support letters, numbers, and hyphens. */
export function sanitizeReferenceCode(value: unknown, maxLength?: number): string {
  const reference = String(value ?? '').toUpperCase().replace(/[^A-Z0-9-]/g, '');
  return maxLength ? reference.slice(0, maxLength) : reference;
}
