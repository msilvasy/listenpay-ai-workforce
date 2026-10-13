/**
 * Shape of the account payload returned by POST /account/auth/{email}.
 * Adjust the fields below to match your actual .NET API DTO — this is a
 * reasonable starting shape (id/email/name/token) with an index signature
 * so unexpected extra fields from the API don't cause type errors.
 */
export interface AccountModel {
  id?: string;
  email: string;
  fullName?: string;
  token?: string;
  points?: number;
  [key: string]: unknown;
}
