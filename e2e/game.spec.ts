import { expect, test, type Page } from '@playwright/test';

async function move(page: Page, from: string, to: string) {
  await page.locator(`[data-sq="${from}"]`).click();
  await page.locator(`[data-sq="${to}"]`).click();
}

async function noHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow).toBe(false);
}

test('chơi với máy trên mobile 360px: đi một nước, máy đáp lại, không tràn ngang', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await page.goto('/ai');
  await page.getByLabel('Siêu dễ').check();
  await page.getByTestId('ai-start').click();
  await move(page, 'h2', 'e2');
  // Quân phải thực sự được vẽ ở ô mới (không chỉ ghi vào danh sách nước đi)
  await expect(page.locator('.piece[data-piece-sq="e2"]')).toHaveCount(1);
  await expect(page.locator('.piece[data-piece-sq="h2"]')).toHaveCount(0);
  await expect(page.locator('.move-list .mv.black')).toHaveCount(1, { timeout: 15_000 });
  await expect(page.locator('.piece.black')).toHaveCount(16);
  await expect(page.locator('.piece.black.just-moved')).toHaveCount(1);
  await expect(page.locator('.move-list .mv.red').first()).toHaveText('P2-5');
  await noHorizontalOverflow(page);
  await ctx.close();
});

test('online: tạo phòng → khách vào → sẵn sàng → đi quân → reload giữa trận → đầu hàng; khán giả xem trên mobile; thống kê cập nhật', async ({
  browser,
}) => {
  const hostCtx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  const guestCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const specCtx = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });
  const host = await hostCtx.newPage();
  const guest = await guestCtx.newPage();
  const spec = await specCtx.newPage();

  // Chủ phòng tạo phòng công khai, cầm Đỏ
  await host.goto('/online');
  await host.getByTestId('create-color').selectOption('red');
  await host.getByTestId('create-room').click();
  await host.waitForURL(/\/room\/[a-z0-9]+$/);
  const roomUrl = host.url();
  const roomId = roomUrl.split('/room/')[1];

  // Phòng xuất hiện ở sảnh của khách
  await guest.goto('/online');
  await expect(guest.getByTestId('room-list')).toContainText('Chờ đối thủ');
  await guest.goto(`/room/${roomId}`);
  await guest.getByTestId('claim-seat').click();
  await expect(host.getByTestId('room-status')).toContainText('chờ hai bên sẵn sàng');

  // Khán giả vào xem (mobile)
  await spec.goto(`/room/${roomId}`);
  await expect(spec.getByText('Bạn đang xem phòng này.')).toBeVisible();

  await host.getByTestId('ready-btn').click();
  await guest.getByTestId('ready-btn').click();

  // Trận bắt đầu
  await expect(host.getByTestId('turn-indicator')).toContainText('Đến lượt bạn');
  await expect(spec.getByText('Bạn đang xem (chỉ đọc)')).toBeVisible();
  await move(host, 'h2', 'e2');
  await expect(host.locator('.piece[data-piece-sq="e2"]')).toHaveCount(1);
  await expect(guest.getByTestId('turn-indicator')).toContainText('Đến lượt bạn');
  await expect(guest.locator('.piece[data-piece-sq="e2"]')).toHaveCount(1);
  await expect(spec.locator('.piece[data-piece-sq="e2"]')).toHaveCount(1);
  await move(guest, 'h9', 'g7');
  await expect(spec.locator('.move-list')).toContainText('M8.7');

  // Khán giả không đi được quân (bàn bị khóa)
  await spec.locator('[data-sq="h0"]').click();
  await expect(spec.locator('.target')).toHaveCount(0);

  // Reload giữa trận: trạng thái lấy lại từ server
  await host.reload();
  await expect(host.locator('.move-list')).toContainText('P2-5');
  await expect(host.getByTestId('turn-indicator')).toContainText('Đến lượt bạn');
  await move(host, 'h0', 'g2');
  await expect(guest.locator('.move-list')).toContainText('M2.3');

  // Số người xem (theo UID) hiển thị cho người chơi
  await expect(host.getByTestId('spectators')).toHaveText('1');

  // Khách đầu hàng
  await guest.getByTestId('resign').click();
  await guest.getByTestId('confirm-resign').click();
  await expect(host.getByTestId('result-banner')).toContainText('Bạn thắng!');
  await expect(guest.getByTestId('result-banner')).toContainText('Bạn thua');
  await expect(spec.getByTestId('result-banner')).toContainText('thắng');
  await noHorizontalOverflow(spec);

  // Thống kê giao hữu cập nhật trong hồ sơ (dữ liệu thật từ Firestore emulator)
  await expect
    .poll(
      async () => {
        await host.goto('/profile');
        return (await host.locator('.stat').filter({ hasText: 'Giao hữu' }).locator('strong').textContent())?.trim();
      },
      { timeout: 30_000, intervals: [1000, 2000] },
    )
    .toBe('1');
  await expect(host.getByTestId('history')).toContainText('Thắng');

  await Promise.all([hostCtx.close(), guestCtx.close(), specCtx.close()]);
});
