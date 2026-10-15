import { expect, test } from '@playwright/test';

/**
 * Smoke test: load the template, change a task's duration, and check that its successors move
 * and the project finish updates.
 */
test('template loads; a duration change moves successors and the project finish', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByTestId('new-from-template').click();
  await page.locator('#pl-name').fill('Smoke test');
  await page.locator('#pl-start').fill('2026-11-02');
  await page.getByTestId('confirm').click();

  const row = (id: number) => page.locator(`[data-testid=grid-row][data-row-id="${id}"]`);
  const cell = (id: number, col: string) => row(id).locator(`[data-col="${col}"]`);
  await expect(row(1)).toContainText('Acquisition & Feasibility');
  await expect(page.getByTestId('project-finish')).toHaveText('Wed 19 Dec 29');

  // Row 4 = A03 "Letter of intent", critical; its successor row 5 = A04.
  await expect(cell(4, 'name')).toHaveText('Letter of intent negotiated & signed');
  await expect(cell(5, 'start')).toHaveText('Mon 30 Nov 26');
  const finishBefore = await page.getByTestId('project-finish').textContent();

  await cell(4, 'duration').dblclick();
  await page.getByTestId('editor-duration').fill('20');
  await page.keyboard.press('Enter');

  await expect(cell(4, 'duration')).toHaveText('20 days');
  // 10 more working days: A04 now starts two weeks later.
  await expect(cell(5, 'start')).toHaveText('Mon 14 Dec 26');
  await expect(cell(6, 'start')).not.toHaveText('Mon 21 Dec 26');
  await expect(page.getByTestId('project-finish')).not.toHaveText(finishBefore!);
  await expect(page.getByTestId('project-finish')).toHaveText('Wed 02 Jan 30'); // +10 working days

  // Undo restores the original schedule.
  await page.getByTestId('undo').click();
  await expect(cell(5, 'start')).toHaveText('Mon 30 Nov 26');
  await expect(page.getByTestId('project-finish')).toHaveText('Wed 19 Dec 29');
});
