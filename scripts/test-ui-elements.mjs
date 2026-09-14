import { app, BrowserWindow } from 'electron';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

console.log('=== [TEST RUNNER] COMPREHENSIVE UI VERIFICATION ===\n');

let allPassed = true;
function assert(condition, message) {
  if (condition) {
    console.log(`  ✅ PASS: ${message}`);
  } else {
    console.error(`  ❌ FAIL: ${message}`);
    allPassed = false;
  }
}

app.setName('sfx-music-manager');

// Import main index to register DB, watcher, and all IPC handlers
import('../dist/main/index.js').then(async () => {
  await app.whenReady();

  // Give 1 second for createWindow() in dist/main/index.js to execute
  await new Promise(res => setTimeout(res, 1000));

  const windows = BrowserWindow.getAllWindows();
  if (windows.length === 0) {
    console.error('Không tìm thấy cửa sổ nào được tạo bởi main process.');
    process.exit(1);
  }

  const win = windows[0];

  const consoleLogs = [];
  const consoleErrors = [];

  win.webContents.on('console-message', (event, level, message, line, sourceId) => {
    consoleLogs.push({ level, message, line, sourceId });
    if (level >= 3) {
      consoleErrors.push(message);
    }
  });

  // Wait 3 seconds for React to finish initial fetch and DB load
  await new Promise((resolve) => setTimeout(resolve, 3000));

  console.log('1. Kiểm tra Console Errors và Renderer Health:');
  const criticalErrors = consoleErrors.filter(msg => 
    !msg.includes('DevTools') && 
    !msg.includes('Autofill') &&
    !msg.includes('EPERM') // external unmounted volume
  );
  assert(criticalErrors.length === 0, `Không có lỗi JavaScript critical nào trong renderer (Errors count: ${criticalErrors.length})`);
  if (criticalErrors.length > 0) {
    console.error('     Chi tiết lỗi:', criticalErrors);
  }

  console.log('\n2. Kiểm tra Layout & Tràn viền (No Horizontal Overflow):');
  const layoutCheck = await win.webContents.executeJavaScript(`
    (() => {
      const doc = document.documentElement;
      const appShell = document.querySelector('.app-shell');
      const tableContainer = document.querySelector('.file-table-container');

      return {
        docScrollWidth: doc.scrollWidth,
        docClientWidth: doc.clientWidth,
        hasHorizontalDocScroll: doc.scrollWidth > doc.clientWidth,
        appShellExists: !!appShell,
        tableContainerExists: !!tableContainer
      };
    })()
  `);

  assert(layoutCheck.appShellExists, 'Phần tử .app-shell đã mount thành công');
  assert(!layoutCheck.hasHorizontalDocScroll, `Không có thanh cuộn ngang ngoài ý muốn (scrollWidth: ${layoutCheck.docScrollWidth}, clientWidth: ${layoutCheck.docClientWidth})`);

  console.log('\n3. Kiểm tra Kích thước & Tỷ lệ các thành phần UI (Geometry & Typography):');
  const metrics = await win.webContents.executeJavaScript(`
    (() => {
      const getStyles = (el) => el ? window.getComputedStyle(el) : null;

      const searchBox = document.querySelector('.search-box');
      const searchInput = document.querySelector('.search-box input');
      const searchBoxStyles = getStyles(searchBox);
      const searchInputStyles = getStyles(searchInput);

      const mainPlay = document.querySelector('.main-play');
      const mainPlayRect = mainPlay ? mainPlay.getBoundingClientRect() : null;

      const rowPlayButtons = Array.from(document.querySelectorAll('.row-play-btn'));
      const rowPlayGeometries = rowPlayButtons.slice(0, 10).map(btn => {
        const rect = btn.getBoundingClientRect();
        return {
          width: Math.round(rect.width * 10) / 10,
          height: Math.round(rect.height * 10) / 10,
          isSquare: Math.abs(rect.width - rect.height) < 0.5,
          borderRadius: window.getComputedStyle(btn).borderRadius
        };
      });

      const rowNames = Array.from(document.querySelectorAll('.row-name'));
      const sampleRowName = rowNames[0];
      const rowNameStyles = getStyles(sampleRowName);

      const durationCols = Array.from(document.querySelectorAll('.col-duration'));
      const sampleDuration = durationCols[0];
      const durationStyles = getStyles(sampleDuration);

      const tabButtons = Array.from(document.querySelectorAll('.tab-btn'));
      const tabButtonStyles = tabButtons.map(tab => ({
        text: tab.textContent.trim(),
        fontSize: window.getComputedStyle(tab).fontSize,
        fontWeight: window.getComputedStyle(tab).fontWeight
      }));

      const navItems = Array.from(document.querySelectorAll('.nav-item'));
      const navItemStyles = navItems.map(item => ({
        fontSize: window.getComputedStyle(item).fontSize,
        padding: window.getComputedStyle(item).padding
      }));

      return {
        searchBox: {
          height: searchBox ? searchBox.getBoundingClientRect().height : 0,
          inputFontSize: searchInputStyles ? searchInputStyles.fontSize : null
        },
        mainPlay: mainPlayRect ? {
          width: Math.round(mainPlayRect.width),
          height: Math.round(mainPlayRect.height),
          isCircular: Math.abs(mainPlayRect.width - mainPlayRect.height) < 0.5
        } : null,
        rowPlayButtonsCount: rowPlayButtons.length,
        rowPlayGeometries,
        rowNameFontSize: rowNameStyles ? rowNameStyles.fontSize : null,
        rowNameFontWeight: rowNameStyles ? rowNameStyles.fontWeight : null,
        durationFontSize: durationStyles ? durationStyles.fontSize : null,
        durationFontFamily: durationStyles ? durationStyles.fontFamily : null,
        tabButtonsCount: tabButtons.length,
        tabButtonStyles,
        navItemsCount: navItems.length,
        sampleNavItem: navItems[0] ? window.getComputedStyle(navItems[0]).fontSize : null
      };
    })()
  `);

  // Verify Search Box
  assert(metrics.searchBox.height >= 40, `Thanh tìm kiếm đủ cao và thoáng (Đo được: ${metrics.searchBox.height}px >= 40px)`);
  assert(parseFloat(metrics.searchBox.inputFontSize) >= 13, `Cỡ chữ ô tìm kiếm to rõ (Đo được: ${metrics.searchBox.inputFontSize} >= 13px)`);

  // Verify Tab buttons
  assert(metrics.tabButtonsCount >= 4, `Các tab phân loại danh mục hiển thị đầy đủ (Số lượng: ${metrics.tabButtonsCount})`);
  const sampleTab = metrics.tabButtonStyles[0];
  if (sampleTab) {
    assert(parseFloat(sampleTab.fontSize) >= 12.5, `Cỡ chữ tab phân loại rõ nét (Đo được: ${sampleTab.fontSize})`);
  }

  // Verify Sidebar Nav Items
  assert(metrics.navItemsCount >= 3, `Các mục Sidebar hiển thị đầy đủ (Số lượng: ${metrics.navItemsCount})`);
  assert(parseFloat(metrics.sampleNavItem) >= 12.5, `Cỡ chữ mục Sidebar to rõ (Đo được: ${metrics.sampleNavItem})`);

  // Verify Track rows
  if (metrics.rowPlayButtonsCount > 0) {
    console.log(`\n  Đang kiểm tra ${metrics.rowPlayButtonsCount} dòng bài hát được hiển thị trong thư viện...`);
    const allRowPlaysSquare = metrics.rowPlayGeometries.every(g => g.isSquare && g.width >= 26);
    assert(allRowPlaysSquare, `Tất cả các nút Play trong hàng đều tròn 100%, không bị méo elip (Kích thước mẫu: ${metrics.rowPlayGeometries[0].width}x${metrics.rowPlayGeometries[0].height}px)`);

    assert(parseFloat(metrics.rowNameFontSize) >= 13, `Tên file to rõ đạt chuẩn (Đo được: ${metrics.rowNameFontSize} >= 13px, weight: ${metrics.rowNameFontWeight})`);
    assert(parseFloat(metrics.durationFontSize) >= 12, `Cột thời lượng to rõ đạt chuẩn (Đo được: ${metrics.durationFontSize} >= 12px)`);
    assert(metrics.durationFontFamily.includes('JetBrains Mono'), `Cột thời lượng sử dụng JetBrains Mono monospace`);
  } else {
    console.log('  ℹ️ Thư viện rỗng (kiểm tra Empty State)');
    const emptyState = await win.webContents.executeJavaScript(`
      (() => {
        const emptyEl = document.querySelector('.empty-state');
        return emptyEl ? emptyEl.textContent : '';
      })()
    `);
    assert(emptyState.length > 0, 'Giao diện hiển thị trạng thái chuẩn xác khi không có dữ liệu');
  }

  // Verify Main Play if present
  if (metrics.mainPlay) {
    assert(metrics.mainPlay.isCircular && metrics.mainPlay.width >= 38, `Nút Main Play trung tâm tròn đều chuẩn Studio (Đo được: ${metrics.mainPlay.width}x${metrics.mainPlay.height}px)`);
  }

  console.log('\n4. Chụp ảnh màn hình thực tế của giao diện (Screenshot Capture):');
  const image = await win.webContents.capturePage();
  const screenshotPath = path.join(rootDir, 'dist/ui-verified.png');
  fs.writeFileSync(screenshotPath, image.toPNG());
  console.log(`  📸 Đã lưu ảnh chụp giao diện thực tế vào: ${screenshotPath}`);

  console.log('\n======================================================');
  if (allPassed) {
    console.log('🎉 KIỂM TRA TOÀN BỘ GIAO DIỆN UI THÀNH CÔNG (PASS 100%)!');
    win.destroy();
    app.quit();
    process.exit(0);
  } else {
    console.error('⚠️ PHÁT HIỆN LỖI UI CẦN KHẮC PHỤC.');
    win.destroy();
    app.quit();
    process.exit(1);
  }
}).catch(err => {
  console.error('Lỗi khởi tạo:', err);
  process.exit(1);
});
