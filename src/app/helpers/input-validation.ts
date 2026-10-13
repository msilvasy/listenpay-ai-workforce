/**
 * Input-validation rules for the recommended "Try a signal" feature, following the
 * OWASP Input Validation Cheat Sheet. They mirror the server-side source of truth:
 *   ListenPay.WebApi/Helpers/InputValidation.cs  (API)
 *   documentation/recommended-signals-input-validation.sql  (SQL CHECK constraints)
 * Keep all three in sync.
 *
 * Client-side checks are for correctness and UX only; the API always re-validates.
 * Data coming back from the API is treated as untrusted too and validated before it
 * reaches the DOM (where it is still only ever written with textContent, never innerHTML).
 */

export const CATEGORY_NAME_MIN_LENGTH = 2;
export const CATEGORY_NAME_MAX_LENGTH = 100;
export const SIGNAL_TEXT_MIN_LENGTH = 12;
export const SIGNAL_TEXT_MAX_LENGTH = 400;
export const SIGNAL_TAKE_MIN = 1;
export const SIGNAL_TAKE_MAX = 10;
export const COMPANY_ID_MIN = 0; // 0 = global defaults
export const COMPANY_ID_MAX = 2147483647; // SQL int / C# int.MaxValue

/** Letters/digits plus space & ' ( ) , . / - ; starts with a letter/digit, ends with a letter/digit, ')' or '.'. */
export const CATEGORY_NAME_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9 &'(),./-]{0,98}[A-Za-z0-9).])?$/;

/** Printable ASCII except < >, plus typographic quotes, en/em dashes and ellipsis. */
export const SIGNAL_TEXT_PATTERN = /^[\x20-\x3B\x3D\x3F-\x7E\u2018\u2019\u201C\u201D\u2013\u2014\u2026]+$/;

/** Canonicalize free text: Unicode NFC, then trim. Returns null for non-strings or invalid Unicode. */
export function normalizeText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    return value.normalize('NFC').trim();
  } catch {
    return null;
  }
}

export function isValidCategoryName(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= CATEGORY_NAME_MIN_LENGTH &&
    value.length <= CATEGORY_NAME_MAX_LENGTH &&
    CATEGORY_NAME_PATTERN.test(value)
  );
}

export function isValidSignalText(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= SIGNAL_TEXT_MIN_LENGTH &&
    value.length <= SIGNAL_TEXT_MAX_LENGTH &&
    value === value.trim() &&
    SIGNAL_TEXT_PATTERN.test(value)
  );
}

export function isValidCompanyId(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= COMPANY_ID_MIN && (value as number) <= COMPANY_ID_MAX;
}

export function isValidTake(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= SIGNAL_TAKE_MIN && (value as number) <= SIGNAL_TAKE_MAX;
}

// ---- Guidance responses (POST api/GuidanceResponse) ----
export const PROMPT_MIN_LENGTH = 12;
export const PROMPT_MAX_LENGTH = 800;
export const GUIDANCE_FIELD_MAX_LENGTH = 4000;
export const GUIDANCE_MODULE_MAX_LENGTH = 1000;
export const GUIDANCE_MODULES_MAX = 20;

/** Unicode categories rejected in free text (control, format, surrogate, private use, unassigned, line/paragraph separators). */
const DISALLOWED_FREE_TEXT = /[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Cn}\p{Zl}\p{Zp}]/u;
const LINE_BREAKS_AND_TAB = /[\r\n\t]/g;
const ZERO_WIDTH_JOINER = /\u200D/g;

/**
 * Free text (prompts, AI output), mirroring InputValidation.IsValidFreeText on the API:
 * must already be trimmed, within the length range, and contain no control/format/
 * private-use/unassigned characters (CR/LF/TAB allowed only when allowLineBreaks).
 */
export function isValidFreeText(value: unknown, minLength: number, maxLength: number, allowLineBreaks: boolean): value is string {
  if (typeof value !== 'string' || value.length < minLength || value.length > maxLength || value !== value.trim()) {
    return false;
  }
  let candidate = value.replace(ZERO_WIDTH_JOINER, '');
  if (allowLineBreaks) candidate = candidate.replace(LINE_BREAKS_AND_TAB, '');
  return !DISALLOWED_FREE_TEXT.test(candidate);
}

const GUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isGuid(value: unknown): value is string {
  return typeof value === 'string' && GUID_PATTERN.test(value) && value !== '00000000-0000-0000-0000-000000000000';
}
