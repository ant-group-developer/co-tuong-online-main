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

test('khách: tự có ID + đổi tên; hồ sơ/đăng nhập là 2 tab; nối email giữ ID; tạo phòng rồi đi trang khác vẫn được giữ trong phòng', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();

  // 1) Vào web là có tài khoản khách với ID 6 ký tự, lưu trong DB
  await page.goto('/profile');
  const code = (await page.getByTestId('profile-code').textContent())!.trim();
  expect(code).toMatch(/^[A-Z0-9]{6}$/);
  await expect(page.getByTestId('profile-name')).toHaveText(`Khách ${code}`);
  await expect(page.getByTestId('tab-login')).toHaveText('Đăng nhập');

  // 2) Khách đổi tên, tải lại trang vẫn còn (đọc lại từ Firestore)
  await page.getByTestId('name-edit').click();
  await page.getByTestId('name-input').fill('Kỳ Thủ E2E');
  await page.getByTestId('name-save').click();
  await expect(page.getByTestId('nav-profile')).toContainText('Kỳ Thủ E2E');
  await page.reload();
  await expect(page.getByTestId('profile-name')).toHaveText('Kỳ Thủ E2E');
  await expect(page.getByTestId('profile-code')).toHaveText(code);

  // 3) Xếp hạng không cần đăng nhập
  await page.goto('/ranked');
  await expect(page.getByTestId('mm-start')).toBeEnabled();

  // 4) Tạo phòng → sang trang khác → vẫn được nhắc + quay lại đúng phòng
  await page.goto('/online');
  await page.getByTestId('create-room').click();
  await page.waitForURL(/\/room\/[a-z0-9]+$/);
  const roomId = page.url().split('/room/')[1];
  await page.goto('/ai');
  await expect(page.getByTestId('active-room-bar')).toContainText(roomId);
  await page.getByTestId('back-to-room').click();
  await page.waitForURL(new RegExp(`/room/${roomId}$`));
  await page.goto('/online');
  await expect(page.getByTestId('my-room')).toContainText(roomId);
  await expect(page.getByTestId('create-room')).toBeDisabled();
  await page.goto('/ranked');
  await expect(page.getByTestId('ranked-blocked')).toContainText(roomId);
  await expect(page.getByTestId('mm-start')).toBeDisabled();
  // Hủy phòng → hết bị giữ
  await page.goto(`/room/${roomId}`);
  await page.getByRole('button', { name: 'Hủy phòng' }).click();
  await page.waitForURL(/\/online$/);
  await expect(page.getByTestId('my-room')).toHaveCount(0);
  await expect(page.getByTestId('create-room')).toBeEnabled();

  // 5) Tab Đăng nhập: tạo tài khoản email => nối vào khách, giữ nguyên ID và tên; tab đổi thành "Tài khoản"
  await page.goto('/login'); // route cũ chuyển sang tab đăng nhập
  await page.waitForURL(/\/profile\?tab=login/);
  await page.getByTestId('login-toggle').click();
  await page.getByLabel('Tên hiển thị').fill('Không Dùng');
  await page.getByTestId('login-email').fill(`e2e_${Date.now()}@test.local`);
  await page.getByTestId('login-password').fill('secret123');
  await page.getByTestId('login-submit').click();
  await expect(page.getByTestId('tab-account')).toHaveText('Tài khoản');
  await expect(page.getByTestId('profile-code')).toHaveText(code);
  await expect(page.getByTestId('profile-name')).toHaveText('Kỳ Thủ E2E'); // tên đã tự đặt được giữ
  await expect(page.locator('.profile-head .badge')).toHaveText('Thành viên');
  await expect(page.getByTestId('tab-login')).toHaveCount(0);
  await page.getByTestId('tab-account').click();
  await expect(page.getByTestId('sign-out')).toBeVisible();
  await ctx.close();
});

test('chơi với máy: chọn mức qua link, đổi máy giữa ván giữ thế cờ, thua thì gợi ý mức dễ hơn, chọn máy khác cho ván mới', async ({ page }) => {
  await page.goto('/ai?level=hard');
  await expect(page.locator('input[value="hard"]')).toBeChecked();
  await page.locator('input[value="super_easy"]').check();
  await page.getByTestId('ai-start').click();
  await expect(page.getByTestId('opponent-name')).toContainText('Siêu dễ');
  await move(page, 'h2', 'e2');
  await expect(page.locator('.move-list .mv.black')).toHaveCount(1, { timeout: 15_000 });

  await page.getByTestId('change-ai').click();
  await page.locator('.modal input[value="easy"]').check();
  await page.getByTestId('switch-keep').click();
  await expect(page.getByTestId('opponent-name')).toContainText('Máy · Dễ');
  await expect(page.locator('.move-list .mv')).toHaveCount(2); // thế cờ giữ nguyên

  await page.getByTestId('ai-resign').click();
  await expect(page.getByTestId('try-easier')).toContainText('Siêu dễ');
  await page.getByTestId('result-change-ai').click();
  await expect(page.getByTestId('switch-keep')).toHaveCount(0); // ván đã xong: chỉ còn "Ván mới"
  await page.locator('.modal input[value="medium"]').check();
  await page.getByTestId('switch-new').click();
  await expect(page.getByTestId('opponent-name')).toContainText('Trung bình');
  await expect(page.locator('.move-list .mv')).toHaveCount(0);
});

test('đa ngôn ngữ: đổi EN/VI, nhớ lựa chọn, ký hiệu nước đi đổi theo ngôn ngữ', async ({ page }) => {
  await page.goto('/ai');
  await expect(page.getByTestId('ai-start')).toContainText('Bắt đầu với máy');
  await page.getByTestId('lang-en').click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.getByTestId('ai-start')).toContainText('Start against');
  await page.locator('input[value="super_easy"]').check();
  await page.getByTestId('ai-start').click();
  await move(page, 'h2', 'e2');
  await expect(page.locator('.move-list .mv.red').first()).toHaveText('C2=5');
  await page.getByTestId('lang-vi').click();
  await expect(page.locator('.move-list .mv.red').first()).toHaveText('P2-5');
  await page.getByTestId('lang-en').click();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.getByRole('link', { name: 'Play computer' })).toBeVisible();
});
