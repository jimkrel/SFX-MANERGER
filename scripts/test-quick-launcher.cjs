const { initDatabase, getAppSetting, setAppSetting, getTracks, closeDatabase } = require('../dist/main/db.js');
const { getDefaultShortcut } = require('../dist/main/quickLauncher.js');
const assert = require('assert');

console.log('=== Testing Quick Launcher Backend Logic ===');

initDatabase();

// 1. Test app_settings persistence
console.log('1. Testing app_settings persistence...');
const testKey = 'test_quick_launcher_shortcut';
setAppSetting(testKey, 'Command+Shift+F');
const retrieved = getAppSetting(testKey);
assert.strictEqual(retrieved, 'Command+Shift+F', 'Should retrieve saved shortcut');

setAppSetting(testKey, 'Control+Shift+Space');
const updated = getAppSetting(testKey);
assert.strictEqual(updated, 'Control+Shift+Space', 'Should update saved shortcut on conflict');
console.log('  OK App settings key-value persistence');

// 2. Test default shortcut
console.log('2. Testing default shortcut per platform...');
const defaultSc = getDefaultShortcut();
if (process.platform === 'darwin') {
  assert.strictEqual(defaultSc, 'Command+Shift+.', 'macOS default should be Command+Shift+.');
} else {
  assert.strictEqual(defaultSc, 'Control+Shift+.', 'Windows default should be Control+Shift+.');
}
console.log(`  OK Default shortcut for ${process.platform}: ${defaultSc}`);

// 3. Test getTracks limit
console.log('3. Testing getTracks limit...');
const tracksLimited = getTracks({ limit: 3 });
assert(tracksLimited.length <= 3, 'Tracks returned should not exceed limit 3');
console.log(`  OK getTracks with limit 3 returned ${tracksLimited.length} items`);

// 4. Test normalizeAccelerator and validation
console.log('4. Testing accelerator normalization and validation...');
const { normalizeAccelerator, updateQuickLauncherShortcut } = require('../dist/main/quickLauncher.js');
assert.strictEqual(normalizeAccelerator('cmd+shift+k'), 'Command+Shift+k', 'Should normalize cmd to Command');
assert.strictEqual(normalizeAccelerator('ctrl+alt+space'), 'Control+Alt+space', 'Should normalize ctrl and alt');

// Test empty shortcut rejection
const emptyRes = updateQuickLauncherShortcut('   ');
assert.strictEqual(emptyRes.success, false, 'Should reject empty shortcut');
assert(emptyRes.error && emptyRes.error.includes('trống'), 'Error message should mention empty string');

// Test solitary key rejection (no modifier)
const noModRes = updateQuickLauncherShortcut('A');
assert.strictEqual(noModRes.success, false, 'Should reject shortcut without modifiers');
assert(noModRes.error && noModRes.error.includes('bổ trợ'), 'Error message should mention modifier requirement');
console.log('  OK Normalization and validation rejected invalid hotkeys successfully');

closeDatabase();
console.log('ALL QUICK LAUNCHER TESTS PASSED!');
