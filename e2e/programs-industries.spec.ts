import { test, expect, VALID_CODE, DASHBOARD_URL } from './support/fixtures';

test.describe('Programs (/programs)', () => {
  test('shows program value, feature highlights and navigates to industries @mobile', async ({ page }) => {
    await page.goto('/programs');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Build program value people can recognize.');
    await expect(page.locator('.grid .item')).toHaveCount(3);
    await expect(page.locator('.sectors .tags li')).toHaveText(['FHIR', 'HL7', 'EHR Ledger', 'SEC', '10-K Filing', 'OSHA']);

    await page.getByRole('link', { name: /NEXT: CHOOSE YOUR INDUSTRY/ }).click();
    await expect(page).toHaveURL(/\/industries$/);
  });

  test('back link returns to the portal home', async ({ page }) => {
    await page.goto('/programs');
    await page.getByRole('link', { name: '← PORTAL HOME' }).click();
    await expect(page).toHaveURL(/\/$/);
  });
});

test.describe('Industries (/industries)', () => {
  test.beforeEach(async ({ page, api }) => {
    void api;
    await page.goto('/industries');
  });

  test('lists the three industries', async ({ page }) => {
    await expect(page.locator('.grid button.item')).toHaveCount(3);
    for (const name of ['Health Care', 'Industrial', 'Commercial']) {
      await expect(page.getByRole('button', { name: new RegExp(`Log in to open ${name} programs`, 'i') })).toBeVisible();
    }
    await page.getByRole('link', { name: '← PROGRAM VALUE' }).click();
    await expect(page).toHaveURL(/\/programs$/);
  });

  test('login hands off to the industry dashboard', async ({ page, api }) => {
    // Stand-in for the separate dashboard app on :4300.
    await page.route(`${DASHBOARD_URL}**`, route =>
      route.fulfill({ contentType: 'text/html', body: '<h1>Industry dashboard</h1>' }),
    );

    await page.getByRole('button', { name: /Log in to open Industrial programs/i }).click();
    const dialog = page.locator('app-login-modal dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('#loginModalTitle')).toHaveText('Sign in to Industrial Programs.');
    expect(await page.evaluate(() => sessionStorage.getItem('listenpay-selected-industry'))).toBe('industrial');

    await page.locator('#lmWorkEmail').fill('ops@plant.test');
    await expect(page.locator('#lmAccessCode')).toBeEnabled();
    await page.locator('#lmAccessCode').fill(VALID_CODE);

    // Industry in the query, JWT in the fragment (never sent to the Programs server).
    await expect(page).toHaveURL(url => url.href.startsWith(`${DASHBOARD_URL}?industry=industrial#access_token=`));
    await expect(page.getByRole('heading', { name: 'Industry dashboard' })).toBeVisible();
    const token = new URLSearchParams(new URL(page.url()).hash.slice(1)).get('access_token') ?? '';
    expect(JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).lp_uid).toBe(42);
    expect(api.calls.verify).toEqual([{ email: 'ops@plant.test', code: VALID_CODE }]);
  });

  test('wrong code keeps the user on the page', async ({ page }) => {
    await page.getByRole('button', { name: /Log in to open Commercial programs/i }).click();
    await page.locator('#lmWorkEmail').fill('ops@shop.test');
    await expect(page.locator('#lmAccessCode')).toBeEnabled();
    await page.locator('#lmAccessCode').fill('111111');
    await expect(page.locator('app-login-modal .login-status')).toHaveText(/Invalid or expired access code/);
    await expect(page).toHaveURL(/\/industries$/);
  });

  test('closing the modal resets the flow', async ({ page }) => {
    await page.getByRole('button', { name: /Log in to open Health Care programs/i }).click();
    await page.locator('#lmWorkEmail').fill('nurse@clinic.test');
    await expect(page.locator('#lmAccessCode')).toBeEnabled();
    await page.locator('app-login-modal').getByRole('button', { name: 'Close login form' }).click();
    await expect(page.locator('app-login-modal dialog')).toBeHidden();

    await page.getByRole('button', { name: /Log in to open Health Care programs/i }).click();
    await expect(page.locator('#lmWorkEmail')).toHaveValue('');
    await expect(page.locator('#lmAccessCode')).toBeDisabled();
  });
});

test.describe('Legal (/legal)', () => {
  test('has privacy, terms and support sections', async ({ page }) => {
    await page.goto('/legal#terms');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Legal & Support');
    for (const id of ['privacy', 'terms', 'support']) await expect(page.locator(`section#${id} h2`)).toBeVisible();
    await page.getByRole('link', { name: '← Back to ListenPay Portal' }).click();
    await expect(page).toHaveURL(/\/$/);
  });
});
