import { test, expect } from './support/fixtures';
import type { Page } from '@playwright/test';

async function openAgreement(page: Page) {
  await page.goto('/secure-documents');
  await expect(page.locator('#signingEmptyState')).toBeVisible();
  await page.locator('.document-item', { hasText: 'Workforce Program Agreement' }).click();
  await expect(page.locator('#signingPanel')).toBeVisible();
}

test.describe('Secure documents (/secure-documents)', () => {
  test('lists the demo document as pending and opens it', async ({ page }) => {
    await page.goto('/secure-documents');
    const item = page.locator('.document-item');
    await expect(item).toHaveCount(1);
    await expect(item.locator('.document-status')).toHaveText('Pending signature');

    await item.click();
    await expect(page.locator('#signingDocTitle')).toHaveText('Workforce Program Agreement');
    await expect(page.locator('#documentFrame')).toHaveAttribute('src', '/documents/secure-agreement-demo.pdf');
    await expect(page.locator('#downloadOriginal')).toHaveAttribute('download', 'secure-agreement-demo.pdf');
    await expect(page.locator('#signDocumentButton')).toBeDisabled();
  });

  test('typed signature: button enables only with name + agreement, then signs', async ({ page }) => {
    await openAgreement(page);
    const sign = page.locator('#signDocumentButton');

    await page.getByRole('tab', { name: 'Use typed signature' }).click();
    await expect(page.locator('#typeSignaturePanel')).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Use typed signature' })).toHaveAttribute('aria-selected', 'true');

    await page.locator('#typedSignatureName').fill('Jordan Avery');
    await expect(page.locator('#typedSignaturePreview')).toHaveText('Jordan Avery');
    await expect(sign).toBeDisabled();

    await page.locator('#signatureAgreement').check();
    await expect(sign).toBeEnabled();
    await page.locator('#signatureAgreement').uncheck();
    await expect(sign).toBeDisabled();
    await page.locator('#signatureAgreement').check();

    await sign.click();
    await expect(page.locator('#signedBanner')).toBeVisible();
    await expect(page.locator('#signedMeta')).toContainText('Signed by Jordan Avery');
    await expect(sign).toBeHidden();
    await expect(page.locator('.document-item .document-status')).toHaveText('Signed');

    // Signature survives a reload within the same session.
    await page.reload();
    await expect(page.locator('.document-item .document-status')).toHaveText('Signed');

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      (async () => {
        await page.locator('.document-item').click();
        await page.locator('#downloadCertificate').click();
      })(),
    ]);
    expect(download.suggestedFilename()).toMatch(/\.pdf$/);
  });

  test('only the active signature style panel is shown', async ({ page }) => {
    await openAgreement(page);
    await expect(page.locator('#typeSignaturePanel')).toBeHidden();
    await page.getByRole('tab', { name: 'Use typed signature' }).click();
    await expect(page.locator('#drawSignaturePanel')).toBeHidden();
  });

  test('drawn signature: needs a stroke on the pad; Clear resets it', async ({ page }) => {
    await openAgreement(page);
    const sign = page.locator('#signDocumentButton');
    await page.locator('#typedSignatureName').fill('Jordan Avery');
    await page.locator('#signatureAgreement').check();
    await expect(sign).toBeDisabled(); // no stroke yet

    const pad = page.locator('#signaturePad');
    const box = (await pad.boundingBox())!;
    await page.mouse.move(box.x + 20, box.y + box.height / 2);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) await page.mouse.move(box.x + 20 + i * 20, box.y + box.height / 2 + (i % 2 ? 15 : -15));
    await page.mouse.up();
    await expect(sign).toBeEnabled();

    await page.locator('#clearSignature').click();
    await expect(sign).toBeDisabled();
  });

  test('back button returns to the workspace', async ({ page }) => {
    await page.goto('/secure-documents');
    await page.getByRole('button', { name: '← Back to workspace' }).click();
    await expect(page).toHaveURL(/\/workspace$/);
  });
});
