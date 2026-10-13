import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable } from 'rxjs';
import { map, switchMap } from 'rxjs/operators';
import { AccountModel } from '../models/account.model';
import { AppResourceService } from './app-resource.service';
import { AppStorageService } from './app-storage.service';

export interface AccountApiResponse<T = AccountModel> {
  responseCode: number;
  responseMessage: string;
  dataSet: T | Record<string, never>;
}

export interface Verify2FAData {
  token?: string;
  key?: string;
  codeVerifyStatus?: boolean;
  message?: string;
}

@Injectable({ providedIn: 'root' })
export class ListenPayAuthService {
  private readonly listenPayAccountSubject = new BehaviorSubject<AccountModel | null>(null);
  readonly listenPayAccount$ = this.listenPayAccountSubject.asObservable();

  constructor(
    private httpClient: HttpClient,
    private appResourceService: AppResourceService,
    private appStorageService: AppStorageService,
  ) {}

  listenPayLogin(email: string) {
    return this.authenticate(email).pipe(
      map(response => {
        const account = response.dataSet as AccountModel;
        this.appStorageService.saveUserInformation(account);
        const currentAccount = this.appStorageService.getAccountInfo;
        this.listenPayAccountSubject.next(currentAccount);
        return account;
      }),
    );
  }

  authenticate(email: string): Observable<AccountApiResponse> {
    return this.httpClient.post<AccountApiResponse>(
      `${this.appResourceService.configValue.listenPayUrl}Account/auth/${encodeURIComponent(email)}`,
      {},
    );
  }

  createAccount(email: string): Observable<AccountApiResponse> {
    return this.httpClient.post<AccountApiResponse>(
      `${this.appResourceService.configValue.listenPayUrl}Account/${encodeURIComponent(email)}`,
      {},
    );
  }

  verify2FACode(email: string, code: string): Observable<AccountApiResponse<Verify2FAData>> {
    return this.httpClient.post<AccountApiResponse<Verify2FAData>>(
      `${this.appResourceService.configValue.listenPayUrl}Account/Verify2FA`,
      { email, code },
    );
  }

  ensureAccountAndSendAccessCode(email: string, onStep?: (message: string) => void): Observable<AccountApiResponse> {
    return this.authenticate(email).pipe(
      switchMap(authResponse => {
        if (authResponse.responseCode === 1) {
          onStep?.('Sending access code...');
          return [authResponse];
        }

        if (authResponse.responseCode !== 2) {
          throw new Error(authResponse.responseMessage || 'The email could not be checked.');
        }

        onStep?.('Creating your account...');
        return this.createAccount(email).pipe(
          switchMap(accountResponse => {
            if (accountResponse.responseCode !== 1) {
              throw new Error(accountResponse.responseMessage || 'Your account could not be created.');
            }

            onStep?.('Sending access code...');
            return this.authenticate(email);
          }),
        );
      }),
    );
  }

  signout(): void {
    this.appStorageService.clearUserInformation();
    this.listenPayAccountSubject.next(null);
  }
}
