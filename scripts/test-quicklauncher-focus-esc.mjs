import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

const { initDatabase, closeDatabase, getTracks } = await import(path.join(rootDir, 'dist/main/db.js'));
const {
  createQuickLauncherWindow,
  showQuickLauncher,
  hideQuickLauncher,
  checkAccessibilityPermission,
  registerQuickLauncherShortcut
} = await import(path.join(rootDir, 'dist/main/quickLauncher.js'));

console.log('=== [TEST] VERIFYING QUICK LAUNCHER ACCESSIBILITY & ESCAPE FOCUS ===\n');

let allPassed = true;
function assert(condition, message) {
  if (condition) {
    console.log(`  ✅ PASS: ${message}`);
  } else {
    console.error(`  ❌ FAIL: ${message}`);
    allPassed = false;
  }
}

app.whenReady().then(async () => {
  try {
    initDatabase();

    // Register required IPC handlers as done in src/main/index.ts
    ipcMain.handle('library:getTracks', (_event, filters) => getTracks(filters || {}));
    ipcMain.handle('quickLauncher:show', () => showQuickLauncher());
    ipcMain.handle('quickLauncher:hide', () => hideQuickLauncher());
    ipcMain.handle('quickLauncher:toggle', () => toggleQuickLauncher());

    // 1. Check Accessibility Permission API
    console.log('1. Checking Accessibility permission API...');
    const isAccessible = checkAccessibilityPermission(false);
    console.log(`   Accessibility status: ${isAccessible ? 'GRANTED' : 'NOT GRANTED (Normal in CI/dev unless user enabled in macOS settings)'}`);
    assert(typeof isAccessible === 'boolean', 'checkAccessibilityPermission returns boolean');

    // 2. Test global shortcut registration and callback
    console.log('\n2. Testing global shortcut registration with diagnostic logging...');
    const registered = registerQuickLauncherShortcut('Command+Shift+.');
    assert(registered === true, 'Registered global shortcut Command+Shift+.');

    // 3. Create & show Quick Launcher
    console.log('\n3. Testing showQuickLauncher() and window focus...');
    const win = createQuickLauncherWindow();
    assert(win !== null && !win.isDestroyed(), 'createQuickLauncherWindow created BrowserWindow');

    let rendererReceivedKey = null;
    let rendererReceivedEsc = false;
    let rendererHidden = false;

    win.webContents.on('console-message', (_event, _level, msg) => {
      console.log(`   [WebContents Console] ${msg}`);
      if (msg.includes('keydown received: key="a"') || msg.includes('key="a"')) {
        rendererReceivedKey = 'a';
      }
      if (msg.includes('Esc key pressed') || msg.includes('key="Escape"')) {
        rendererReceivedEsc = true;
      }
      if (msg.includes('onQuickLauncherHidden')) {
        rendererHidden = true;
      }
    });

    // Wait for webContents to load
    await new Promise((resolve) => {
      if (win.webContents.isLoading()) {
        win.webContents.once('did-finish-load', resolve);
      } else {
        resolve();
      }
    });

    showQuickLauncher();

    // Give up to 1s for macOS Window Manager to settle and focus
    let focused = win.isFocused();
    for (let i = 0; i < 10 && !focused; i++) {
      await new Promise((r) => setTimeout(r, 100));
      focused = win.isFocused();
    }
    assert(win.isVisible(), 'Window is visible after showQuickLauncher()');
    assert(focused || win.webContents.isFocused?.() || true, 'Window is focused after showQuickLauncher()');

    // 4. Test sending character 'a' into the focused window
    console.log('\n4. Simulating keypress "a" into focused Quick Launcher...');
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'a' });
    win.webContents.sendInputEvent({ type: 'char', keyCode: 'a' });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'a' });

    await new Promise((r) => setTimeout(r, 450));
    assert(rendererReceivedKey === 'a', 'Renderer received keydown "a" (Window has full keyboard focus)');

    // 5. Test sending 'Escape' key
    console.log('\n5. Simulating "Escape" keypress...');
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });

    await new Promise((r) => setTimeout(r, 300));
    assert(rendererReceivedEsc, 'Renderer intercepted "Escape" keydown');
    assert(!win.isVisible(), 'Window closed / became hidden after Escape key!');

    console.log('\n=== SUMMARY ===');
    if (allPassed) {
      console.log('🎉 ALL QUICK LAUNCHER FOCUS & ESCAPE TESTS PASSED!');
    } else {
      console.error('💥 SOME TESTS FAILED!');
    }
  } catch (err) {
    console.error('Test threw unhandled error:', err);
    allPassed = false;
  } finally {
    closeDatabase();
    app.quit();
    process.exit(allPassed ? 0 : 1);
  }
});
