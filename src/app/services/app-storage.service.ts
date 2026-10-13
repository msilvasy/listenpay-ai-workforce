import { Injectable } from '@angular/core';
import { AccountModel } from '../models/account.model';
import { isValidCompanyId } from '../helpers/input-validation';

const ACCOUNT_STORAGE_KEY = 'listenpay-account';
/** Where the login modal stores the API token after 2FA. */
const TOKEN_STORAGE_KEY = 'token';
/** RBAC claim carrying UserInformationId (AppClaims.UserId on the API). */
const USER_ID_CLAIM = 'lp_uid';

@Injectable({ providedIn: 'root' })
export class AppStorageService {
  /** sessionStorage so the signed-in account clears when the browser tab closes. */
  saveUserInformation(account: AccountModel): void {
    sessionStorage.setItem(ACCOUNT_STORAGE_KEY, JSON.stringify(account));
  }

  get getAccountInfo(): AccountModel | null {
    const raw = sessionStorage.getItem(ACCOUNT_STORAGE_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as AccountModel;
    } catch {
      return null;
    }
  }

  /**
   * Company of the signed-in account, or 0 when signed out. sessionStorage is user-editable,
   * so the value is validated (whole number in the SQL int range) before any API sees it.
   */
  get companyId(): number {
    const account = this.getAccountInfo;
    const raw = account?.['companyId'] ?? account?.['CompanyId'];
    const id = typeof raw === 'string' && /^\d{1,10}$/.test(raw.trim()) ? Number(raw.trim()) : raw;
    return isValidCompanyId(id) ? id : 0;
  }

  clearUserInformation(): void {
    sessionStorage.removeItem(ACCOUNT_STORAGE_KEY);
  }

  /**
   * The signed-in user's API token (stored by the login modal after 2FA), or null when there
   * is none, it isn't a well-formed JWT, it has expired, or it predates RBAC (no user id claim).
   * Decoding here is only to decide whether to send it; the API verifies the signature.
   */
  get apiSession(): { token: string; userId: number } | null {
    let token: string | null = null;
    try {
      token = localStorage.getItem(TOKEN_STORAGE_KEY);
    } catch {
      return null;
    }
    if (!token || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) return null;

    try {
      const segment = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      const claims = JSON.parse(atob(segment.padEnd(segment.length + ((4 - (segment.length % 4)) % 4), '=')));
      const expiresAt = typeof claims?.exp === 'number' ? claims.exp * 1000 : 0;
      const userId = Number(claims?.[USER_ID_CLAIM]);
      if (expiresAt <= Date.now() || !Number.isSafeInteger(userId) || userId <= 0) return null;
      return { token, userId };
    } catch {
      return null;
    }
  }
}

