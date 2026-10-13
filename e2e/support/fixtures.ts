import { test as base, expect, Page, Route } from '@playwright/test';

/**
 * Base URL of the ListenPay .NET API as configured in src/environments/environment.ts.
 * Override with E2E_API_URL if the environment file points somewhere else.
 */
export const API_URL = (process.env['E2E_API_URL'] ?? 'https://localhost:5001/api/').replace(/\/?$/, '/');

/** Industry dashboard the Industries page hands off to after login (environment.dashboardUrl). */
export const DASHBOARD_URL = process.env['E2E_DASHBOARD_URL'] ?? 'http://localhost:4300/dashboard';

export const VALID_CODE = '246810';

export type SignalCategories = Record<string, string[]>;

export const DEFAULT_SIGNALS: SignalCategories = {
  'Health & Wellness': [
    'Nurses are skipping the new hand-off checklist on night shifts.',
    'Patient-privacy refreshers are overdue for two clinic teams.',
    'Front desk staff need help with escalation for upset patients.',
  ],
  'Safety & Training': [
    'Near-miss reports dropped sharply after the new shift rotation.',
    'New hires are unsure how to report a lockout/tagout concern.',
    'Supervisors want a refresher on ladder and fall protection.',
  ],
  Compliance: [
    'Quarterly policy attestation completion is behind schedule.',
    'Managers are unclear on the updated gifts and entertainment policy.',
    'Speak-up hotline usage is low across distribution sites.',
  ],
  'Skilled Trades': ['Apprentices need a refresher on torque procedures.'],
  Logistics: ['Dock teams are missing load-check steps during peak hours.'],
};

export interface GuidanceApiData {
  priority: string;
  firstStep: string;
  trainingModules: string[];
  complianceLens: string;
  note: string;
}

export const SAMPLE_GUIDANCE: GuidanceApiData = {
  priority: 'Rebuild consistent hand-off habits on night shift.',
  firstStep: 'Run a 10-minute huddle with charge nurses to walk through the checklist together.',
  trainingModules: ['Structured hand-off practice', 'Escalation scripts', 'Supervisor spot checks'],
  complianceLens: 'Align with the approved clinical hand-off policy and keep completion evidence.',
  note: 'Educational guidance only. Validate against approved organizational policies and compliance resources.',
};

export interface ApiMockOptions {
  /** Categories returned by GET RecommendedSignal; `'error'` returns HTTP 500. */
  signals?: SignalCategories | 'error' | { raw: unknown };
  /** responseCode for POST Account/auth/{email}: 1 = existing account (code sent), 2 = unknown email. */
  authResponseCode?: number;
  /** The code POST Account/Verify2FA accepts. */
  validCode?: string;
  /** Body for POST AI/Recommendation, or a status + error to fail with. */
  recommendation?: GuidanceApiData | { status: number; error: string };
  /** Signed-in history (GET GuidanceResponse). */
  serverHistory?: { scope: 'Own' | 'Company' | 'All'; items: ServerHistoryItem[] };
}

export interface ServerHistoryItem {
  id: string;
  program: string;
  prompt: string;
  priority: string;
  responseCreatedAt: string;
  canDelete?: boolean;
  createdByEmail?: string;
  firstStep?: string;
  compliance?: string;
  note?: string;
  modules?: string[];
}

/** Everything the app sent to the mocked API, for assertions. */
export interface ApiCalls {
  auth: string[];
  createAccount: string[];
  verify: Array<{ email: string; code: string }>;
  recommendation: Array<{ program: string; prompt: string }>;
  savedResponses: Array<Record<string, any>>;
  deleted: string[];
  signalQueries: URLSearchParams[];
}

export interface ApiMock {
  calls: ApiCalls;
  /** Change the mock's behaviour mid-test. */
  set(options: Partial<ApiMockOptions>): void;
}

const ok = (dataSet: unknown, responseMessage = 'OK') => ({ responseCode: 1, responseMessage, dataSet });

/** Installs a stateful mock of the ListenPay .NET API on the page. */
export async function mockListenPayApi(page: Page, initial: ApiMockOptions = {}): Promise<ApiMock> {
  let options: ApiMockOptions = {
    signals: DEFAULT_SIGNALS,
    authResponseCode: 1,
    validCode: VALID_CODE,
    recommendation: SAMPLE_GUIDANCE,
    ...initial,
  };
  const calls: ApiCalls = {
    auth: [], createAccount: [], verify: [], recommendation: [], savedResponses: [], deleted: [], signalQueries: [],
  };
  const createdAccounts = new Set<string>();

  await page.route(`${API_URL}**`, async (route: Route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = decodeURIComponent(url.pathname.replace(new URL(API_URL).pathname, ''));
    const method = request.method();
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body), headers: { 'access-control-allow-origin': '*' } });

    if (method === 'OPTIONS') {
      return route.fulfill({
        status: 204,
        headers: {
          'access-control-allow-origin': '*',
          'access-control-allow-methods': 'GET,POST,DELETE,OPTIONS',
          'access-control-allow-headers': 'content-type,authorization',
        },
      });
    }

    if (method === 'GET' && path === 'RecommendedSignal') {
      calls.signalQueries.push(url.searchParams);
      const signals = options.signals;
      if (signals === 'error') return json({ error: 'boom' }, 500);
      if (signals && 'raw' in signals) return json(signals.raw);
      return json(
        ok(Object.entries(signals ?? {}).map(([category, list]) => ({
          category,
          signals: list.map(signalText => ({ signalText })),
        }))),
      );
    }

    const authMatch = path.match(/^Account\/auth\/(.+)$/i);
    if (method === 'POST' && authMatch) {
      const email = authMatch[1];
      calls.auth.push(email);
      const code = createdAccounts.has(email) ? 1 : options.authResponseCode;
      return json({ responseCode: code, responseMessage: code === 1 ? 'Code sent' : 'Account not found', dataSet: {} });
    }

    if (method === 'POST' && /^Account\/Verify2FA$/i.test(path)) {
      const body = request.postDataJSON() as { email: string; code: string };
      calls.verify.push(body);
      if (body.code === options.validCode) {
        return json(ok({ codeVerifyStatus: true, token: makeJwt({ lp_uid: 42 }), key: 'test-key' }));
      }
      return json(ok({ codeVerifyStatus: false }));
    }

    const createMatch = path.match(/^Account\/(.+@.+)$/i);
    if (method === 'POST' && createMatch) {
      calls.createAccount.push(createMatch[1]);
      createdAccounts.add(createMatch[1]);
      return json(ok({ email: createMatch[1] }));
    }

    if (method === 'POST' && path === 'AI/Recommendation') {
      calls.recommendation.push(request.postDataJSON());
      const rec = options.recommendation!;
      if ('status' in rec) return json({ error: rec.error }, rec.status);
      return json({ guidance: rec });
    }

    if (path === 'GuidanceResponse' && method === 'POST') {
      calls.savedResponses.push(request.postDataJSON());
      return json(ok({}), 201);
    }

    if (path === 'GuidanceResponse' && method === 'GET') {
      const history = options.serverHistory ?? { scope: 'Own' as const, items: [] };
      return json(ok({ items: history.items, total: history.items.length, scope: history.scope }));
    }

    const entryMatch = path.match(/^GuidanceResponse\/([0-9a-f-]{36})$/i);
    if (entryMatch && method === 'GET') {
      const item = options.serverHistory?.items.find(i => i.id === entryMatch[1]);
      if (!item) return json({}, 404);
      return json(ok({ ...item, modules: item.modules ?? ['Module A', 'Module B', 'Module C'] }));
    }
    if (entryMatch && method === 'DELETE') {
      calls.deleted.push(entryMatch[1]);
      if (options.serverHistory) {
        options.serverHistory.items = options.serverHistory.items.filter(i => i.id !== entryMatch[1]);
      }
      return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } });
    }

    return json({ error: `Unmocked ${method} ${path}` }, 501);
  });

  return { calls, set: next => (options = { ...options, ...next }) };
}

/** An unsigned JWT the app accepts (it only decodes claims; the real API verifies signatures). */
export function makeJwt(claims: Record<string, unknown>, expiresInSeconds = 3600): string {
  const b64 = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ exp: Math.floor(Date.now() / 1000) + expiresInSeconds, ...claims })}.c2lnbmF0dXJl`;
}

/** Puts a signed-in session in storage before any app code runs. */
export async function signIn(page: Page, { userId = 42, companyId = 7 } = {}): Promise<void> {
  const token = makeJwt({ lp_uid: userId });
  await page.addInitScript(
    ([t, account]) => {
      localStorage.setItem('token', t);
      localStorage.setItem('key', 'test-key');
      sessionStorage.setItem('listenpay-authenticated', 'true');
      sessionStorage.setItem('listenpay-account', account);
    },
    [token, JSON.stringify({ email: 'lead@acme.test', companyId })] as const,
  );
}

/**
 * Marks the current test as covering a known, unfixed app bug. The test is expected to fail;
 * once the bug is fixed Playwright reports it as "unexpectedly passed" – then delete this call.
 */
export function knownBug(description: string): void {
  test.info().annotations.push({ type: 'known bug', description });
  test.fail();
}

type Fixtures = { api: ApiMock };

/** `test` with the API already mocked (default options). Call `api.set(...)` to change behaviour. */
export const test = base.extend<Fixtures>({
  api: async ({ page }, use) => {
    await use(await mockListenPayApi(page));
  },
});

export { expect };
