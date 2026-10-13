import { Injectable } from '@angular/core';
import { ConfigService } from './config.service';
import { AppStorageService } from './app-storage.service';
import { HttpClient } from '@angular/common/http';
import { AppResourceService } from './app-resource.service';
import { firstValueFrom, timeout } from 'rxjs';
import {
  GUIDANCE_FIELD_MAX_LENGTH,
  GUIDANCE_MODULE_MAX_LENGTH,
  GUIDANCE_MODULES_MAX,
  PROMPT_MAX_LENGTH,
  PROMPT_MIN_LENGTH,
  isGuid,
  isValidCategoryName,
  isValidFreeText,
  normalizeText,
} from '../helpers/input-validation';

export interface Guidance {
  priority: string;
  firstStep: string;
  modules: string[];
  compliance: string;
  note: string;
}

export interface HistoryEntry {
  id: string | number;
  program: string;
  prompt: string;
  guidance: Guidance;
  createdAt: string;
}

interface ProgramTemplate {
  focus: string;
  modules: string[];
  lens: string;
}

interface RecommendationApiData {
  priority: string;
  firstStep: string;
  trainingModules: string[];
  complianceLens: string;
  note: string;
}

const HISTORY_KEY = 'listenpay-guidance-history';
/** Responses that could not be saved to the API yet (offline, API down); retried later. */
const PENDING_SAVE_KEY = 'listenpay-guidance-pending-v2';
const LEGACY_PENDING_SAVE_KEY = 'listenpay-guidance-pending-save';
const PENDING_SAVE_MAX = 24;

/**
 * Body of POST api/GuidanceResponse (same shape as a history entry). No companyId or user id:
 * with RBAC the API takes both from the caller's token.
 */
interface GuidanceResponsePayload {
  id: string;
  program: string;
  prompt: string;
  guidance: Guidance;
  createdAt: string;
}

/** A queued save, bound to the user who generated it so it's never sent under someone else's token. */
interface PendingSave {
  ownerUserId: number;
  payload: GuidanceResponsePayload;
}

type SaveOutcome = 'saved' | 'rejected' | 'retry';

/** One row of the database-backed History panel (GET api/GuidanceResponse). */
export interface HistorySummary {
  id: string;
  program: string;
  prompt: string;
  priority: string;
  createdAt: string;
  companyId: number;
  createdByUserId: number | null;
  /** Only provided in admin (Company/All) views. */
  createdByEmail: string | null;
  canDelete: boolean;
}

export interface ServerHistoryPage {
  items: HistorySummary[];
  total: number;
  /** The caller's read scope from dbo.GuidanceRolePermission: Own, Company or All. */
  scope: 'Own' | 'Company' | 'All' | 'None';
}

/** Rows shown in the History panel (newest first). */
const SERVER_HISTORY_TAKE = 50;

const TEMPLATES: Record<string, ProgramTemplate> = {
  'Health & Wellness': {
    focus: 'Build consistent care-team confidence around the identified practice.',
    modules: [
      'Situation recognition and escalation',
      'Clear patient-facing communication',
      'Supervisor coaching and follow-through',
    ],
    lens: 'Map the learning activity to your approved clinical policies, role scopes, and required documentation practices.',
  },
  'Safety & Training': {
    focus: 'Rebuild proactive reporting and safe-decision habits around the observed signal.',
    modules: [
      'Hazard and near-miss recognition',
      'Psychological safety in reporting',
      'Closed-loop supervisor communication',
    ],
    lens: 'Connect the refresher to your approved internal safety procedures and retain completion evidence as required.',
  },
  Compliance: {
    focus: 'Turn policy awareness into consistent, observable frontline decisions.',
    modules: [
      'Policy-to-practice scenarios',
      'Speaking up and escalation',
      'Manager accountability checkpoints',
    ],
    lens: "Validate the final training plan with the organization's approved policies and compliance owners before rollout.",
  },
  'Secure Documents': {
    focus: 'Strengthen reliable handling and approval habits for sensitive documents.',
    modules: [
      'Information classification basics',
      'Secure review and signing workflow',
      'Exception escalation and audit trail awareness',
    ],
    lens: 'Align delivery with your approved information-handling standards, access controls, and document retention requirements.',
  },
  'Skilled Trades': {
    focus: 'Reinforce the practical work habits that keep teams prepared, precise, and safe.',
    modules: [
      'Pre-task planning and hazard review',
      'Equipment and procedure refresh',
      'Peer checks and supervisor observation',
    ],
    lens: "Use the organization's approved task procedures and relevant site requirements to validate the learning content.",
  },
  Logistics: {
    focus: 'Improve consistent decision-making across handoffs, movement, and exception handling.',
    modules: [
      'Safe handoffs and load checks',
      'Exception reporting and escalation',
      'Route, dock, and distribution communication',
    ],
    lens: 'Review the recommendation against your approved transportation, distribution, and incident-reporting procedures.',
  },
};

@Injectable({ providedIn: 'root' })
export class GuidanceService {
  /** Program tile metadata, in display order. */
  readonly programs = Object.keys(TEMPLATES);

   constructor(private httpClient: HttpClient,  private appResourceService: AppResourceService,
        private appStorageService: AppStorageService) {
      

    }

  private summaryOf(text: string): string {
    const words = text.trim().replace(/\s+/g, ' ').split(' ');
    return words.slice(0, 11).join(' ') + (words.length > 11 ? '…' : '');
  }

  /** Offline fallback guidance, used when opened as a local file or the API call fails. */
  makeOfflineGuidance(userPrompt: string, selectedProgram: string): Guidance {
    const template = TEMPLATES[selectedProgram] ?? TEMPLATES['Health & Wellness'];
    const context = this.summaryOf(userPrompt).replace(/[.?!]+$/, '');
    return {
      priority: template.focus,
      firstStep: `Brief the responsible leads on “${context}” and agree on one measurable behavior to reinforce in the next seven days.`,
      modules: template.modules,
      compliance: template.lens,
      note: "This offline fallback is educational planning guidance, not a compliance determination. Validate the final training plan through your organization's approved policy and compliance resources.",
    };
  }

  async requestLiveRecommendation(program: string, prompt: string): Promise<Guidance> {
    const response = await fetch(`${this.appResourceService.configValue.listenPayUrl}AI/Recommendation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ program, prompt }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const errorMessage = !Array.isArray(payload) && typeof payload?.error === 'string' ? payload.error : '';
      throw new Error(errorMessage || 'The live recommendation service could not complete the request.');
    }

    const recommendation = Array.isArray(payload)
      ? payload[0]?.result?.data?.json as RecommendationApiData | undefined
      : payload?.guidance as RecommendationApiData | undefined;

    if (!recommendation || !Array.isArray(recommendation.trainingModules)) {
      throw new Error('The live recommendation service returned an unexpected response.');
    }

    return {
      priority: recommendation.priority,
      firstStep: recommendation.firstStep,
      modules: recommendation.trainingModules,
      compliance: recommendation.complianceLens,
      note: recommendation.note,
    };
  }

  /** True when served over http(s) (i.e. through the Node server), not opened as a local file. */
  get isHosted(): boolean {
    return typeof window !== 'undefined' && (window.location.protocol === 'http:' || window.location.protocol === 'https:');
  }

  async generate(program: string, prompt: string): Promise<Guidance> {
    if (this.isHosted) {
      try {
        return await this.requestLiveRecommendation(program, prompt);
      } catch (error) {
        throw error instanceof Error ? error : new Error("We couldn't generate that recommendation.");
      }
    }
    return this.makeOfflineGuidance(prompt, program);
  }

  // ---------------------------------------------------------------------------
  // Server-side storage (dbo.GuidanceResponse / dbo.GuidanceResponseModule)
  // ---------------------------------------------------------------------------

  /**
   * GUID for a new history entry; it is also the GuidanceResponseId and the idempotency key
   * for saving. crypto.randomUUID only exists in secure contexts (https or localhost), so fall
   * back to an RFC 4122 v4 id built from crypto.getRandomValues. Never Date.now(): the API
   * requires a GUID and rejects numeric ids.
   */
  newId(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
    bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC 4122 variant
    const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  /**
   * Saves a generated response to the API under the signed-in user (RBAC: the API requires a
   * valid token and stores the response in that user's company). Signed-out users keep the
   * device-only history. Never throws and never blocks the UI: if the API can't be reached the
   * entry is queued for this user and retried by flushPendingSaves().
   */
  async saveResponse(entry: HistoryEntry): Promise<void> {
    const session = this.appStorageService.apiSession;
    if (!session) return; // not signed in (or token expired): nothing is stored server-side

    const payload = this.toPayload(entry);
    if (!payload) {
      console.warn('GuidanceService: response not saved, it failed client-side validation.');
      return;
    }
    const outcome = await this.postResponse(payload, session.token);
    if (outcome === 'retry') {
      this.queuePendingSave({ ownerUserId: session.userId, payload });
    } else {
      void this.flushPendingSaves();
    }
  }

  /**
   * Retries queued saves (call on workspace load). Only the current user's entries are sent,
   * with their own token; entries the API rejects are dropped.
   */
  async flushPendingSaves(): Promise<void> {
    this.dropLegacyPendingSaves();
    const session = this.appStorageService.apiSession;
    const pending = this.readPendingSaves();
    if (!session || !pending.length || !this.isHosted) return;

    const stillPending: PendingSave[] = [];
    for (const item of pending) {
      if (item.ownerUserId !== session.userId) {
        stillPending.push(item); // someone else's: wait for them to sign in
        continue;
      }
      if ((await this.postResponse(item.payload, session.token)) === 'retry') stillPending.push(item);
    }
    this.writePendingSaves(stillPending);
  }

  private async postResponse(payload: GuidanceResponsePayload, token: string): Promise<SaveOutcome> {
    if (!this.isHosted) return 'retry';
    try {
      await firstValueFrom(
        this.httpClient
          .post(`${this.appResourceService.configValue.listenPayUrl}GuidanceResponse`, payload, {
            headers: { Authorization: `Bearer ${token}` },
          })
          .pipe(timeout(10000)),
      );
      return 'saved'; // 201 stored, or 200 already stored (idempotent retry)
    } catch (error: unknown) {
      const status = (error as { status?: number })?.status ?? 0;
      if (status === 400 || status === 409 || status === 413) {
        // The API will never accept this payload; retrying would only repeat the failure.
        console.warn(`GuidanceService: API rejected a guidance response (HTTP ${status}).`);
        return 'rejected';
      }
      // 401/403: token expired, revoked or issued before RBAC; kept for this user and sent
      // again after they sign in. Network errors, timeouts and 5xx are retried the same way.
      return 'retry';
    }
  }

  /** Builds the API payload, applying the same rules the API enforces (OWASP: validate before sending). */
  private toPayload(entry: HistoryEntry): GuidanceResponsePayload | null {
    const id = typeof entry?.id === 'string' ? entry.id.toLowerCase() : null;
    const program = normalizeText(entry?.program);
    const prompt = normalizeText(entry?.prompt);
    const guidance = entry?.guidance;
    const created = new Date(entry?.createdAt);
    if (!isGuid(id) || !isValidCategoryName(program) || Number.isNaN(created.getTime())) return null;
    if (!isValidFreeText(prompt, PROMPT_MIN_LENGTH, PROMPT_MAX_LENGTH, true) || !guidance) return null;

    const fields = [guidance.priority, guidance.firstStep, guidance.compliance, guidance.note].map(normalizeText);
    if (!fields.every(value => isValidFreeText(value, 1, GUIDANCE_FIELD_MAX_LENGTH, true))) return null;

    const modules = Array.isArray(guidance.modules) ? guidance.modules.map(normalizeText) : [];
    if (modules.length < 1 || modules.length > GUIDANCE_MODULES_MAX) return null;
    if (!modules.every(value => isValidFreeText(value, 1, GUIDANCE_MODULE_MAX_LENGTH, false))) return null;

    const [priority, firstStep, compliance, note] = fields as string[];
    return {
      id,
      program,
      prompt,
      guidance: { priority, firstStep, modules: modules as string[], compliance, note },
      createdAt: created.toISOString(),
    };
  }

  private readPendingSaves(): PendingSave[] {
    try {
      const parsed = JSON.parse(localStorage.getItem(PENDING_SAVE_KEY) || '[]');
      return Array.isArray(parsed)
        ? parsed.filter(p => Number.isSafeInteger(p?.ownerUserId) && p.ownerUserId > 0 && isGuid(p?.payload?.id))
        : [];
    } catch {
      return [];
    }
  }

  /** Queue entries from before RBAC have no owner, so they can't be attributed safely: discard them. */
  private dropLegacyPendingSaves(): void {
    try {
      localStorage.removeItem(LEGACY_PENDING_SAVE_KEY);
    } catch {
      // ignore
    }
  }

  private writePendingSaves(items: PendingSave[]): void {
    try {
      if (items.length) localStorage.setItem(PENDING_SAVE_KEY, JSON.stringify(items.slice(-PENDING_SAVE_MAX)));
      else localStorage.removeItem(PENDING_SAVE_KEY);
    } catch {
      // Storage full or blocked: the response is still in the in-page history.
    }
  }

  private queuePendingSave(item: PendingSave): void {
    const pending = this.readPendingSaves().filter(p => p.payload.id !== item.payload.id);
    this.writePendingSaves([...pending, item]);
  }

  // ---------------------------------------------------------------------------
  // Database-backed history (signed-in users). Each call sends the user's token;
  // the API decides what they may see or delete from their role.
  // ---------------------------------------------------------------------------

  /** True when the History panel should read from the database instead of this device. */
  get usesServerHistory(): boolean {
    return this.isHosted && !!this.appStorageService.apiSession;
  }

  async loadServerHistory(take = SERVER_HISTORY_TAKE): Promise<ServerHistoryPage> {
    const page = await this.apiGet<{ items?: unknown[]; total?: number; scope?: string }>(`GuidanceResponse?skip=0&take=${take}`);
    const scope = page?.scope === 'Company' || page?.scope === 'All' || page?.scope === 'Own' ? page.scope : 'None';
    const items = (Array.isArray(page?.items) ? page.items : [])
      .map(raw => this.toHistorySummary(raw))
      .filter((item): item is HistorySummary => item !== null);
    return { items, total: typeof page?.total === 'number' ? page.total : items.length, scope };
  }

  async loadServerEntry(id: string): Promise<HistoryEntry> {
    if (!isGuid(id)) throw new Error('That recommendation id is not valid.');
    const d = await this.apiGet<Record<string, unknown>>(`GuidanceResponse/${encodeURIComponent(id)}`);
    const modules = Array.isArray(d?.['modules']) ? (d['modules'] as unknown[]).filter((m): m is string => typeof m === 'string') : [];
    const text = (key: string) => (typeof d?.[key] === 'string' ? (d[key] as string) : '');
    if (!isGuid(d?.['id'])) throw new Error('The saved recommendation could not be read.');
    return {
      id: d['id'] as string,
      program: text('program'),
      prompt: text('prompt'),
      createdAt: text('responseCreatedAt'),
      guidance: {
        priority: text('priority'),
        firstStep: text('firstStep'),
        modules,
        compliance: text('compliance'),
        note: text('note'),
      },
    };
  }

  async deleteServerEntry(id: string): Promise<void> {
    if (!isGuid(id)) throw new Error('That recommendation id is not valid.');
    const session = this.requireSession();
    try {
      await firstValueFrom(
        this.httpClient
          .delete(`${this.appResourceService.configValue.listenPayUrl}GuidanceResponse/${encodeURIComponent(id)}`, {
            headers: { Authorization: `Bearer ${session.token}` },
          })
          .pipe(timeout(10000)),
      );
    } catch (error) {
      throw this.toFriendlyError(error, "We couldn't delete that recommendation.");
    }
  }

  private async apiGet<T>(path: string): Promise<T> {
    const session = this.requireSession();
    try {
      const response = await firstValueFrom(
        this.httpClient
          .get<{ responseCode?: number; dataSet?: T }>(`${this.appResourceService.configValue.listenPayUrl}${path}`, {
            headers: { Authorization: `Bearer ${session.token}` },
          })
          .pipe(timeout(10000)),
      );
      if (response?.responseCode !== 1 || response.dataSet == null) throw new Error('Unexpected response.');
      return response.dataSet;
    } catch (error) {
      throw this.toFriendlyError(error, "We couldn't load your saved guidance. Please try again.");
    }
  }

  private requireSession(): { token: string; userId: number } {
    const session = this.appStorageService.apiSession;
    if (!session) throw new Error('Sign in to see your saved guidance.');
    return session;
  }

  private toFriendlyError(error: unknown, fallback: string): Error {
    const status = (error as { status?: number })?.status ?? 0;
    if (status === 401) return new Error('Your session has expired. Sign in again to see your saved guidance.');
    if (status === 403) return new Error("Your account doesn't have access to saved guidance. Sign in again, or ask an administrator.");
    if (status === 404) return new Error('That recommendation no longer exists or is not available to you.');
    return new Error(fallback);
  }

  /** Validates one list row from the API; malformed rows are skipped rather than rendered. */
  private toHistorySummary(raw: unknown): HistorySummary | null {
    const r = raw as Record<string, unknown> | null;
    if (!r || !isGuid(r['id'])) return null;
    const str = (key: string) => (typeof r[key] === 'string' ? (r[key] as string) : '');
    const createdBy = r['createdByUserId'];
    return {
      id: r['id'] as string,
      program: str('program'),
      prompt: str('prompt'),
      priority: str('priority'),
      createdAt: str('responseCreatedAt'),
      companyId: typeof r['companyId'] === 'number' ? (r['companyId'] as number) : 0,
      createdByUserId: Number.isSafeInteger(createdBy) ? (createdBy as number) : null,
      createdByEmail: typeof r['createdByEmail'] === 'string' && r['createdByEmail'].length <= 256 ? (r['createdByEmail'] as string) : null,
      canDelete: r['canDelete'] === true,
    };
  }

  readHistory(): HistoryEntry[] {
    try {
      const raw = localStorage.getItem(HISTORY_KEY);
      return raw ? (JSON.parse(raw) as HistoryEntry[]) : [];
    } catch {
      return [];
    }
  }

  saveHistory(items: HistoryEntry[]): void {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(items.slice(0, 24)));
  }

  addToHistory(entry: HistoryEntry): void {
    this.saveHistory([entry, ...this.readHistory()]);
  }

  clearHistory(): void {
    localStorage.removeItem(HISTORY_KEY);
  }

  recommendationText(entry: HistoryEntry): string {
    return [
      'ListenPay Guidance AI Recommendation',
      `Program: ${entry.program}`,
      `Request: ${entry.prompt}`,
      '',
      `Recommended focus: ${entry.guidance.priority}`,
      '',
      `Start here: ${entry.guidance.firstStep}`,
      '',
      'Training modules:',
      ...entry.guidance.modules.map(module => `• ${module}`),
      '',
      `Compliance lens: ${entry.guidance.compliance}`,
      '',
      entry.guidance.note,
    ].join('\n');
  }
}
