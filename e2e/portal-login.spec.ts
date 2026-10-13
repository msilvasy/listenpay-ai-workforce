import { test, expect, VALID_CODE } from './support/fixtures';

test.describe('Portal home (/)', () => {
  test.beforeEach(async ({ page, api }) => {
    void api;
    await page.goto('/');
  });

  test('shows both workspace tiles and the regulatory logos @mobile', async ({ page }) => {
    await expect(page).toHaveTitle(/ListenPay/i);
    await expect(page.getByRole('heading', { level: 1, name: 'Choose your ListenPay workspace.' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Log in to open Workplace AI Guidance' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Open Value Training and Compliance Programs' })).toBeVisible();
    await expect(page.locator('[aria-label="Regulatory frameworks"] img')).toHaveCount(5);
  });

  test('theme toggle switches between dark and light', async ({ page }) => {
    const toggle = page.locator('#themeToggle');
    const host = page.locator('app-login');
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await expect(toggle).toContainText('DARK');

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await expect(toggle).toContainText('LIGHT');
    await expect(host).toHaveAttribute('data-theme', 'light');
    expect(await page.evaluate(() => localStorage.getItem('listenpay-portal-theme'))).toBe('light');

    await toggle.click();
    await expect(toggle).toContainText('DARK');
    await expect(host).not.toHaveAttribute('data-theme', 'light');
  });

  test('stored light theme is applied after a reload', async ({ page }) => {
    await page.locator('#themeToggle').click();
    await page.reload();
    await expect(page.locator('#themeToggle')).toContainText('LIGHT');
    await expect(page.locator('app-login')).toHaveAttribute('data-theme', 'light');
  });

  test('Program Value tile opens /programs without a login', async ({ page }) => {
    await page.getByRole('button', { name: 'Open Value Training and Compliance Programs' }).click();
    await expect(page).toHaveURL(/\/programs$/);
    await expect(page.locator('#loginModal')).toHaveCount(0);
  });

  test('unknown routes redirect to the portal home', async ({ page }) => {
    await page.goto('/does-not-exist');
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Choose your ListenPay workspace.');
  });
});

test.describe('Login modal', () => {
  test.beforeEach(async ({ page, api }) => {
    void api;
    await page.goto('/');
    await page.getByRole('button', { name: 'Log in to open Workplace AI Guidance' }).click();
  });

  test('opens titled for the chosen workspace with the email field focused', async ({ page }) => {
    const modal = page.locator('#loginModal');
    await expect(modal).toBeVisible();
    await expect(modal.locator('#loginTitle')).toHaveText('Sign in to Workplace AI Guidance.');
    await expect(page.locator('#workEmail')).toBeFocused();
    await expect(page.locator('#accessCode')).toBeDisabled();
    await expect(page.locator('#role')).toBeDisabled();
  });

  test('validates the work email', async ({ page, api }) => {
    const email = page.locator('#workEmail');
    await email.focus();
    await email.blur();
    await expect(page.locator('#workEmailError')).toHaveText('Enter your work email.');
    await expect(email).toHaveAttribute('aria-invalid', 'true');

    await email.fill('not-an-email');
    await expect(page.locator('#workEmailError')).toHaveText(/Enter a valid email address/);

    await email.fill('lead@acme.test');
    await expect(page.locator('#workEmailError')).toHaveText('');
    await expect(email).toHaveAttribute('aria-invalid', 'false');
    await expect.poll(() => api.calls.auth).toEqual(['lead@acme.test']);
  });

  test('existing user: email -> access code -> workspace', async ({ page, api }) => {
    await page.locator('#workEmail').fill('lead@acme.test');

    await expect(page.locator('#loginStatus')).toHaveText('Enter the 6-digit code from your email.');
    const code = page.locator('#accessCode');
    await expect(code).toBeEnabled();
    await expect(code).toBeFocused();
    await expect(page.locator('#workEmail')).toBeDisabled();
    await expect(page.locator('#loginSubmit')).toBeDisabled();

    // Non-digits are stripped; the 6th digit submits automatically.
    await code.pressSequentially(`ab${VALID_CODE}`);
    await expect(page).toHaveURL(/\/workspace$/);

    expect(api.calls.verify).toEqual([{ email: 'lead@acme.test', code: VALID_CODE }]);
    const storage = await page.evaluate(() => ({
      token: localStorage.getItem('token'),
      authenticated: sessionStorage.getItem('listenpay-authenticated'),
      workspace: sessionStorage.getItem('listenpay-portal-requested-workspace'),
    }));
    expect(storage.token).toMatch(/^[\w-]+\.[\w-]+\.[\w-]+$/);
    expect(storage.authenticated).toBe('true');
    expect(storage.workspace).toBe('/workspace');
  });

  test('Continue button is hidden during the access-code step', async ({ page }) => {
    await page.locator('#workEmail').fill('lead@acme.test');
    await expect(page.locator('#accessCode')).toBeEnabled();
    await expect(page.locator('#loginSubmit')).toBeHidden();
  });

  test('new user: account is created before the code is sent', async ({ page, api }) => {
    api.set({ authResponseCode: 2 });
    await page.locator('#workEmail').fill('new.hire@acme.test');
    await expect(page.locator('#accessCode')).toBeEnabled();
    expect(api.calls.createAccount).toEqual(['new.hire@acme.test']);
    expect(api.calls.auth).toEqual(['new.hire@acme.test', 'new.hire@acme.test']);
  });

  test('wrong access code shows an error and lets the user retry', async ({ page }) => {
    await page.locator('#workEmail').fill('lead@acme.test');
    const code = page.locator('#accessCode');
    await expect(code).toBeEnabled();

    await code.fill('000000');
    await expect(page.locator('#loginStatus')).toHaveText('Invalid or expired access code. Please try again.');
    await expect(code).toHaveValue('');
    await expect(code).toBeEnabled();

    await code.fill(VALID_CODE);
    await expect(page).toHaveURL(/\/workspace$/);
  });

  test('API failure on email check is reported and the form is usable again', async ({ page, api }) => {
    api.set({ authResponseCode: 0 });
    await page.locator('#workEmail').fill('lead@acme.test');
    await expect(page.locator('#loginStatus')).toHaveText('Account not found');
    await expect(page.locator('#workEmail')).toBeEnabled();
    await expect(page.locator('#accessCode')).toBeDisabled();
  });

  test('closing the modal resets it', async ({ page }) => {
    await page.locator('#workEmail').fill('lead@acme.test');
    await expect(page.locator('#accessCode')).toBeEnabled();

    await page.getByRole('button', { name: 'Close login form' }).click();
    await expect(page.locator('#loginModal')).toBeHidden();

    await page.getByRole('button', { name: 'Log in to open Workplace AI Guidance' }).click();
    await expect(page.locator('#workEmail')).toHaveValue('');
    await expect(page.locator('#workEmail')).toBeEnabled();
    await expect(page.locator('#accessCode')).toBeDisabled();
    await expect(page.locator('#loginSubmit')).toBeVisible();
    await expect(page.locator('#loginStatus')).toHaveText('');
  });

  test('forgot password: recovery view validates and confirms', async ({ page }) => {
    await page.getByRole('button', { name: 'Forgot Password?' }).click();
    await expect(page.locator('#recoveryView')).toHaveClass(/is-active/);
    await expect(page.locator('#recoveryEmail')).toBeFocused();

    await page.getByRole('button', { name: /SEND RECOVERY INSTRUCTIONS/ }).click();
    await expect(page.locator('#recoveryEmailError')).toHaveText('Enter your work email.');

    await page.locator('#recoveryEmail').fill('lead@acme.test');
    await page.getByRole('button', { name: /SEND RECOVERY INSTRUCTIONS/ }).click();
    await expect(page.locator('#recoveryStatus')).toContainText('If an account matches this work email');

    await page.getByRole('button', { name: '← Back to Login' }).click();
    await expect(page.locator('#loginView')).toHaveClass(/is-active/);
  });
});
