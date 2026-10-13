import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { firstValueFrom, timeout } from 'rxjs';
import { AppResourceService } from './app-resource.service';
import { AppStorageService } from './app-storage.service';
import { ApiResponseModel, RecommendedSignalCategory } from '../models/recommended-signal.model';
import {
  isValidCategoryName,
  isValidSignalText,
  isValidTake,
  normalizeText,
} from '../helpers/input-validation';

/** Signals shown per category in the workspace "Try a signal" row. */
export const SIGNALS_PER_CATEGORY = 3;

/** Upper bound on categories accepted from the API (there are 6 today). */
const MAX_CATEGORIES = 50;

/** Used only if the API is unreachable, so the workspace never shows an empty row. */
const FALLBACK_SIGNALS: string[] = [
  'Build a short refresher plan for supervisors after a rise in near-miss reports.',
  'Recommend practical training topics before our quarterly policy attestation.',
  'What should our frontline team practice to improve secure document handling?',
];

@Injectable({ providedIn: 'root' })
export class RecommendedSignalService {
  private cache: Promise<Map<string, string[]>> | null = null;

  constructor(
    private http: HttpClient,
    private appResourceService: AppResourceService,
    private appStorageService: AppStorageService,
  ) {}

  /**
   * Company of the signed-in account, or 0 (global defaults) when signed out.
   * The value comes from sessionStorage, which the user can edit, so it is validated
   * (whole number in the SQL int range) before it is ever sent to the API.
   */
  private get companyId(): number {
    return this.appStorageService.companyId;
  }

  /**
   * Loads every category's recommended signals in one request and caches the result
   * (keyed by category name) for the life of the app. A failed request is not cached.
   */
  loadAll(): Promise<Map<string, string[]>> {
    if (!this.cache) {
      if (!isValidTake(SIGNALS_PER_CATEGORY)) {
        return Promise.reject(new Error('SIGNALS_PER_CATEGORY is out of range.'));
      }
      // HttpParams URL-encodes every value; only the parameters the API allowlists are sent.
      const params = new HttpParams()
        .set('companyId', this.companyId)
        .set('take', SIGNALS_PER_CATEGORY);
      const url = `${this.appResourceService.configValue.listenPayUrl}RecommendedSignal`;

      this.cache = firstValueFrom(
        this.http.get<ApiResponseModel<RecommendedSignalCategory[]>>(url, { params }).pipe(timeout(8000)),
      )
        .then(response => this.toSignalMap(response))
        .catch(error => {
          this.cache = null;
          throw error;
        });
    }
    return this.cache;
  }

  /**
   * Recommended signals for one category. Returns [] when the category has no active signals,
   * and the built-in defaults only when the API itself is unreachable or returns invalid data.
   */
  async forCategory(category: string): Promise<string[]> {
    const key = normalizeText(category);
    if (!isValidCategoryName(key)) return [];
    try {
      return (await this.loadAll()).get(key) ?? [];
    } catch {
      return FALLBACK_SIGNALS;
    }
  }

  /**
   * Validates the API payload before anything from it is used (OWASP: treat all external
   * data as untrusted). The envelope must be well formed; individual categories or signals
   * that fail the allowlist rules are dropped rather than repaired.
   */
  private toSignalMap(response: unknown): Map<string, string[]> {
    const envelope = response as Partial<ApiResponseModel<unknown>> | null;
    if (!envelope || typeof envelope !== 'object' || envelope.responseCode !== 1 || !Array.isArray(envelope.dataSet)) {
      throw new Error('Recommended signals are unavailable.');
    }

    const map = new Map<string, string[]>();
    let rejected = 0;

    for (const item of envelope.dataSet.slice(0, MAX_CATEGORIES) as Partial<RecommendedSignalCategory>[]) {
      const category = normalizeText(item?.category);
      if (!isValidCategoryName(category) || map.has(category)) {
        rejected += 1;
        continue;
      }

      const signals: string[] = [];
      const rawSignals = Array.isArray(item.signals) ? item.signals : [];
      for (const signal of rawSignals) {
        const text = normalizeText(signal?.signalText);
        if (!isValidSignalText(text)) {
          rejected += 1;
          continue;
        }
        if (!signals.includes(text)) signals.push(text);
        if (signals.length === SIGNALS_PER_CATEGORY) break;
      }
      map.set(category, signals);
    }

    if (rejected > 0) {
      // Count only: never echo untrusted content into logs.
      console.warn(`RecommendedSignalService: ignored ${rejected} invalid item(s) from the API.`);
    }
    return map;
  }
}
