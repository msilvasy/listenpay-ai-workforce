import { test, expect, DEFAULT_SIGNALS, SAMPLE_GUIDANCE, signIn, ServerHistoryItem } from './support/fixtures';
import type { Page } from '@playwright/test';

const PROMPT = 'Night-shift nurses keep skipping the new hand-off checklist.';

const tile = (page: Page, program: string) => page.locator(`.tiles .tile[data-program="${program}"]`);
const signalButtons = (page: Page) => page.locator('#signalList .signal-enter');

async function generate(page: Page, prompt = PROMPT) {
  await page.locator('#guidancePrompt').fill(prompt);
  await page.locator('#generateButton').click();
}

test.describe('Workspace – program selection & recommended signals', () => {
  test.beforeEach(async ({ page, api }) => {
    void api;
    await page.goto('/workspace');
  });

  test('defaults to Health & Wellness and loads its signals from the API @mobile', async ({ page, api }) => {
    await expect(tile(page, 'Health & Wellness')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#selectedProgram')).toHaveText('Health & Wellness');
    await expect(signalButtons(page)).toHaveText(DEFAULT_SIGNALS['Health & Wellness']);
    await expect(page.locator('#signalSuggestions')).not.toHaveAttribute('aria-busy');

    // Signed out: global defaults (companyId 0), 3 per category.
    expect(api.calls.signalQueries).toHaveLength(1);
    expect(api.calls.signalQueries[0].get('companyId')).toBe('0');
    expect(api.calls.signalQueries[0].get('take')).toBe('3');
  });

  test('selecting a tile updates the pill and the signals (one API call, cached)', async ({ page, api }) => {
    await tile(page, 'Safety & Training').click();
    await expect(tile(page, 'Safety & Training')).toHaveAttribute('aria-pressed', 'true');
    await expect(tile(page, 'Health & Wellness')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('#selectedProgram')).toHaveText('Safety & Training');
    await expect(signalButtons(page)).toHaveText(DEFAULT_SIGNALS['Safety & Training']);

    await tile(page, 'Logistics').click();
    await expect(signalButtons(page)).toHaveText(DEFAULT_SIGNALS['Logistics']);
    expect(api.calls.signalQueries).toHaveLength(1);
  });

  test('clicking a signal fills the prompt', async ({ page }) => {
    const first = DEFAULT_SIGNALS['Health & Wellness'][0];
    await signalButtons(page).first().click();
    await expect(page.locator('#guidancePrompt')).toHaveValue(first);
    await expect(page.locator('#guidancePrompt')).toBeFocused();
  });

  test('Secure Documents tile opens the signing page', async ({ page }) => {
    await tile(page, 'Secure Documents').click();
    await expect(page).toHaveURL(/\/secure-documents$/);
  });
});

test.describe('Workspace – signal API resilience', () => {
  test('falls back to built-in signals when the API is down', async ({ page, api }) => {
    api.set({ signals: 'error' });
    await page.goto('/workspace');
    await expect(signalButtons(page)).toHaveCount(3);
    await expect(signalButtons(page).first()).toHaveText(/near-miss reports/);
  });

  test('drops signals that fail input validation (e.g. markup, too short)', async ({ page, api }) => {
    api.set({
      signals: {
        raw: {
          responseCode: 1,
          dataSet: [
            {
              category: 'Health & Wellness',
              signals: [
                { signalText: '<img src=x onerror=alert(1)> injected signal' },
                { signalText: 'too short' },
                { signalText: 'A perfectly valid recommended signal text.' },
              ],
            },
          ],
        },
      },
    });
    await page.goto('/workspace');
    await expect(signalButtons(page)).toHaveText(['A perfectly valid recommended signal text.']);
    await expect(page.locator('#signalList img')).toHaveCount(0);
  });

  test('shows an empty row for a category the API has no signals for', async ({ page, api }) => {
    api.set({ signals: { 'Safety & Training': ['Only safety has signals in this response.'] } });
    await page.goto('/workspace');
    await expect(page.locator('#signalSuggestions')).toHaveClass(/empty/);
    await expect(signalButtons(page)).toHaveCount(0);
  });
});

test.describe('Workspace – generating guidance', () => {
  test.beforeEach(async ({ page, api }) => {
    void api;
    await page.goto('/workspace');
  });

  test('requires at least 12 characters of context', async ({ page, api }) => {
    await generate(page, 'too short');
    await expect(page.locator('#inlineError')).toBeVisible();
    await expect(page.locator('#inlineError')).toHaveText('Add a little more context so the recommendation can be useful.');
    await expect(page.locator('#guidancePrompt')).toBeFocused();
    expect(api.calls.recommendation).toHaveLength(0);
  });

  test('renders the AI recommendation in the guidance modal', async ({ page, api }) => {
    await tile(page, 'Safety & Training').click();
    await generate(page);

    const modal = page.locator('#guidanceModal');
    await expect(modal).toBeVisible();
    await expect(page.locator('#recommendationPriority')).toHaveText(SAMPLE_GUIDANCE.priority);
    await expect(page.locator('#recommendationStep')).toHaveText(SAMPLE_GUIDANCE.firstStep);
    await expect(page.locator('#recommendationModules li')).toHaveText(SAMPLE_GUIDANCE.trainingModules);
    await expect(page.locator('#recommendationCompliance')).toHaveText(SAMPLE_GUIDANCE.complianceLens);
    await expect(page.locator('#recommendationNote')).toHaveText(SAMPLE_GUIDANCE.note);
    await expect(page.locator('#generateButton')).toBeEnabled();

    expect(api.calls.recommendation).toEqual([{ program: 'Safety & Training', prompt: PROMPT }]);
    // Signed out: nothing is saved to the API.
    expect(api.calls.savedResponses).toHaveLength(0);

    await page.getByRole('button', { name: 'Close guidance' }).click();
    await expect(modal).toBeHidden();
  });

  test('regenerate sends the request again', async ({ page, api }) => {
    await generate(page);
    await expect(page.locator('#recommendationPriority')).toHaveText(SAMPLE_GUIDANCE.priority);

    api.set({ recommendation: { ...SAMPLE_GUIDANCE, priority: 'A second, regenerated focus.' } });
    await page.getByRole('button', { name: 'Regenerate recommendation' }).click();
    await expect(page.locator('#recommendationPriority')).toHaveText('A second, regenerated focus.');
    expect(api.calls.recommendation).toHaveLength(2);
  });

  test('API errors are surfaced inline and the modal closes', async ({ page, api }) => {
    api.set({ recommendation: { status: 429, error: 'The AI provider has reached a rate or quota limit.' } });
    await generate(page);
    await expect(page.locator('#inlineError')).toHaveText('The AI provider has reached a rate or quota limit.');
    await expect(page.locator('#guidanceModal')).toBeHidden();
    await expect(page.locator('#generateButton')).toBeEnabled();
  });

  test('exports the recommendation as a PDF', async ({ page }) => {
    await generate(page);
    await expect(page.locator('#recommendationPriority')).toHaveText(SAMPLE_GUIDANCE.priority);
    const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#exportPdf').click()]);
    expect(download.suggestedFilename()).toBe('listenpay-health-wellness-guidance.pdf');
  });

  test('copies the recommendation to the clipboard', async ({ page, context, browserName }) => {
    test.skip(browserName !== 'chromium', 'clipboard permissions are Chromium-only');
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await generate(page);
    await expect(page.locator('#recommendationPriority')).toHaveText(SAMPLE_GUIDANCE.priority);

    await page.locator('#copyCurrent').click();
    await expect(page.locator('#copyCurrent')).toHaveAttribute('aria-label', 'Recommendation copied');
    const text = await page.evaluate(() => navigator.clipboard.readText());
    expect(text).toContain('ListenPay Guidance AI Recommendation');
    expect(text).toContain(`Request: ${PROMPT}`);
    expect(text).toContain(`Recommended focus: ${SAMPLE_GUIDANCE.priority}`);
  });
});

test.describe('Workspace – device history (signed out)', () => {
  test.beforeEach(async ({ page, api }) => {
    void api;
    await page.goto('/workspace');
  });

  test('starts empty', async ({ page }) => {
    await page.locator('#historyButton').click();
    await expect(page.locator('#historyPanel')).toHaveAttribute('aria-hidden', 'false');
    await expect(page.locator('#historySourceLabel')).toHaveText('Stored on this device');
    await expect(page.locator('#historyList')).toContainText('No saved recommendations yet');
  });

  test('stores generated guidance, reopens it, searches and clears', async ({ page }) => {
    await generate(page);
    await expect(page.locator('#recommendationPriority')).toHaveText(SAMPLE_GUIDANCE.priority);
    await page.getByRole('button', { name: 'Close guidance' }).click();

    await tile(page, 'Logistics').click();
    await generate(page, 'Dock teams are rushing load checks at shift change.');
    await expect(page.locator('#guidanceModal')).toBeVisible();
    await page.getByRole('button', { name: 'Close guidance' }).click();

    // Persisted to localStorage across reloads.
    await page.reload();
    await page.locator('#historyButton').click();
    const records = page.locator('#historyList .history-record');
    await expect(records).toHaveCount(2);
    await expect(records.first()).toContainText('Logistics');
    await expect(records.nth(1)).toContainText('Health & Wellness');

    // Search
    await page.locator('#historySearch').fill('dock');
    await expect(records.filter({ visible: true })).toHaveCount(1);
    await page.locator('#historySearch').fill('zzz no match');
    await expect(page.locator('#historySearchEmpty')).toContainText('No matching recommendations');
    await page.getByRole('button', { name: 'Clear history search' }).click();
    await expect(records.filter({ visible: true })).toHaveCount(2);

    // Reopen an entry: selects its program, restores the prompt and shows the guidance.
    await records.nth(1).locator('.history-item').click();
    await expect(page.locator('#historyPanel')).toHaveAttribute('aria-hidden', 'true');
    await expect(page.locator('#selectedProgram')).toHaveText('Health & Wellness');
    await expect(page.locator('#guidancePrompt')).toHaveValue(PROMPT);
    await expect(page.locator('#guidanceModal')).toBeVisible();
    await page.getByRole('button', { name: 'Close guidance' }).click();

    // Clear (accepting the confirm dialog)
    await page.locator('#historyButton').click();
    page.once('dialog', dialog => dialog.accept());
    await page.locator('#clearHistory').click();
    await expect(page.locator('#historyList')).toContainText('No saved recommendations yet');
    expect(await page.evaluate(() => localStorage.getItem('listenpay-guidance-history'))).toBeNull();
  });

  test('dismissing the clear confirmation keeps history', async ({ page }) => {
    await generate(page);
    await page.getByRole('button', { name: 'Close guidance' }).click();
    await page.locator('#historyButton').click();
    page.once('dialog', dialog => dialog.dismiss());
    await page.locator('#clearHistory').click();
    await expect(page.locator('#historyList .history-record')).toHaveCount(1);
  });

  test('closes with Escape and with the overlay', async ({ page }) => {
    await page.locator('#historyButton').click();
    await expect(page.locator('#historyPanel')).toHaveClass(/show/);
    await page.keyboard.press('Escape');
    await expect(page.locator('#historyPanel')).not.toHaveClass(/show/);
    await expect(page.locator('#historyButton')).toHaveAttribute('aria-expanded', 'false');

    await page.locator('#historyButton').click();
    await page.locator('#overlay').click({ position: { x: 10, y: 10 } });
    await expect(page.locator('#historyPanel')).not.toHaveClass(/show/);
  });
});

test.describe('Workspace – signed in (server history)', () => {
  const items: ServerHistoryItem[] = [
    {
      id: '3f2b8c1e-5d4a-4c6b-9e7f-1a2b3c4d5e6f',
      program: 'Compliance',
      prompt: 'Quarterly attestation is behind schedule in two regions.',
      priority: 'Close the attestation gap before quarter end.',
      responseCreatedAt: '2026-09-30T15:00:00Z',
      canDelete: true,
      firstStep: 'Send managers a completion report.',
      compliance: 'Map to the attestation policy.',
      note: 'Validate against approved policies.',
      modules: ['Attestation walkthrough', 'Manager follow-up', 'Exception handling'],
    },
  ];

  test.beforeEach(async ({ page, api }) => {
    api.set({ serverHistory: { scope: 'Own', items: structuredClone(items) } });
    await signIn(page, { userId: 42, companyId: 7 });
    await page.goto('/workspace');
  });

  test('requests company signals and saves generated guidance to the API', async ({ page, api }) => {
    await expect(signalButtons(page)).toHaveCount(3);
    expect(api.calls.signalQueries[0].get('companyId')).toBe('7');

    await generate(page);
    await expect(page.locator('#recommendationPriority')).toHaveText(SAMPLE_GUIDANCE.priority);
    await expect.poll(() => api.calls.savedResponses.length).toBe(1);
    const saved = api.calls.savedResponses[0];
    expect(saved['id']).toMatch(/^[0-9a-f-]{36}$/);
    expect(saved['program']).toBe('Health & Wellness');
    expect(saved['prompt']).toBe(PROMPT);
    expect(saved['guidance'].modules).toEqual(SAMPLE_GUIDANCE.trainingModules);
    // Signed in: device history is not used.
    expect(await page.evaluate(() => localStorage.getItem('listenpay-guidance-history'))).toBeNull();
  });

  test('history panel lists, opens and deletes saved guidance', async ({ page, api }) => {
    await page.locator('#historyButton').click();
    await expect(page.locator('#historySourceLabel')).toHaveText('Saved to your account');
    await expect(page.locator('#clearHistory')).toBeHidden();
    const record = page.locator('#historyList .history-record');
    await expect(record).toHaveCount(1);
    await expect(record).toContainText(items[0].priority);

    await record.locator('.history-item').click();
    await expect(page.locator('#selectedProgram')).toHaveText('Compliance');
    await expect(page.locator('#recommendationModules li')).toHaveText(items[0].modules!);
    await page.getByRole('button', { name: 'Close guidance' }).click();

    await page.locator('#historyButton').click();
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: 'Delete recommendation' }).click();
    await expect(page.locator('#historyList')).toContainText('No saved recommendations yet');
    expect(api.calls.deleted).toEqual([items[0].id]);
  });
});
