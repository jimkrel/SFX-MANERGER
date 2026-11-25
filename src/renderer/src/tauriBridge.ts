import type { ElectronAPI } from '../../preload';

type Invoke = <T>(command: string, args?: Record<string, unknown> | Uint8Array, options?: { headers: Record<string, string> }) => Promise<T>;
const host = window as unknown as { __TAURI__?: { webviewWindow?: { getCurrentWebviewWindow(): {label:string} }; core: { invoke: Invoke; Channel: new () => { onmessage: () => void } }; event: { listen<T>(name: string, handler: (event: { payload: T }) => void, options?: { target: {kind: 'WebviewWindow'; label: string} }): Promise<() => void> } }; api?: ElectronAPI };

export const isTauriLauncher = host.__TAURI__?.webviewWindow?.getCurrentWebviewWindow().label === 'quick-launcher';

// Keep the existing renderer contract. Unsupported migration commands fail explicitly.
if (host.__TAURI__ && !host.api) {
  const invoke = host.__TAURI__.core.invoke;
  const events = host.__TAURI__.event;
  function listen<T>(name: string, callback: (payload: T) => void) {
    let active = true;
    const registration = events.listen<T>(name, ({ payload }) => { if (active) callback(payload); },
      name.startsWith('tauri://drag-') ? { target: { kind: 'WebviewWindow', label: 'main' } } : undefined);
    return () => { active = false; void registration.then(unlisten => unlisten()); };
  }
  const platform = /Mac/i.test(navigator.platform) ? 'darwin' : /Win/i.test(navigator.platform) ? 'win32' : 'linux';
  const read = (operation: string, options?: unknown) => invoke('library_read', { operation, options });
  const write = (operation: string, fields = {}) => invoke('library_write', { edit: { operation, ...fields } });
  const unsupported = (name: string) => () => Promise.reject(new Error(`Tauri migration pending: ${name}`));
  const call = (command: string, operation: string, args = {}) => invoke(command, { operation, args });
  const capcut = (operation: string, args = {}) => call("capcut_call", operation, args);
  const media = (operation: string, args = {}) => call("media_call", operation, args);
  const core = host.__TAURI__.core;
  const dragEnded = new Set<() => void>();
  const prepareDrag = (paths: string[]) => invoke<string[]>('prepare_drag', { paths });
  async function startDrag(input: string | string[], icon?: string) {
    // macOS completes the native session asynchronously. Only the OS callback signals a drop or cancel.
    const finish = () => dragEnded.forEach(callback => callback());
    try {
      const paths = await prepareDrag(Array.isArray(input) ? input : [input]);
      if (!paths.length) { finish(); return; }
      const channel = new core.Channel();
      channel.onmessage = finish;
      await invoke('plugin:drag|start_drag', {
        item: paths, image: icon || 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAACXBIWXMAAAsTAAALEwEAmpwYAAAAMElEQVR4nO3OMQ0AAAjAMMC/52EBh4eUpmCS3NW17wUAAAAAAAAAAIAVPC8AAADeB61CAQE/Dk1KAAAAAElFTkSuQmCC', options: { mode: 'copy' }, onEvent: channel,
      });
    } catch (error) { console.warn('[Drag]', error); finish(); }
  }
  const bridge = {
    platform, isMac: platform === 'darwin', isWindows: platform === 'win32', isLinux: platform === 'linux',
    getAppInfo: () => invoke('app_info'),
    checkIsElevated: async () => (await invoke<{ isElevated: boolean }>('app_info')).isElevated,
    quitApp: () => invoke('quit_app'),
    startDrag,
    prewarmDrag: async (filePath: string) => (await prepareDrag([filePath]))[0] ?? filePath,
    onDragEnded: (callback: () => void) => { dragEnded.add(callback); return () => { dragEnded.delete(callback); }; },
    showInFolder: (filePath: string) => invoke('reveal_file', { filePath }),
    copyPaths: (paths: string[]) => invoke('copy_paths', { paths }),
    isBouncedCached: (sourcePath: string) => invoke('bounce_check', { sourcePath }),
    clearBounceCache: () => invoke('bounce_clear'),
    saveBouncedWav: (sourcePath: string, buffer: Uint8Array, sourceToken?: string) =>
      invoke('bounce_save', buffer, { headers: {
        'x-source-path': encodeURIComponent(sourcePath),
        ...(sourceToken === undefined ? {} : { 'x-source-token': encodeURIComponent(sourceToken) }),
      } }),
    saveExportedFile: ({ defaultName, buffer, format }: { defaultName: string; buffer: ArrayBuffer | Uint8Array; format: 'wav' | 'mp3' }) =>
      invoke('export_audio', buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer), { headers: {
        'x-audio-format': format, 'x-audio-name': encodeURIComponent(defaultName),
      } }),
    getDbStatus: () => read('status'),
    getWaveformPeaks: (trackId: number, resolution: number, version?: number) => invoke('waveform_peaks', { trackId, resolution, version }),
    readAudioBuffer: async (filePath: string, trackId?: number, version?: number) => {
      const raw = await invoke<ArrayBuffer>('read_audio_buffer', { filePath, trackId, version });
      const bytes = new Uint8Array(raw);
      return bytes.length ? bytes : null;
    },
    addTagToTrack: (trackId: number, tagName: string) => write('addTagToTrack', { trackId, tagName }),
    removeTagFromTrack: (trackId: number, tagId: number) => write('removeTagFromTrack', { trackId, tagId }),
    setRating: (trackId: number, rating: number) => write('setRating', { trackId, rating }),
    toggleFavorite: (trackId: number) => write('toggleFavorite', { trackId }),
    setCategory: (trackId: number, category: string) => write('setCategory', { trackId, category }),
    setBpm: (trackId: number, bpm: number | null, version?: number) => write('setBpm', { trackId, bpm, version }),
    setPeakGain: (trackId: number, peakGain: number, version?: number) => write('setPeakGain', { trackId, peakGain, version }),
    bulkTag: (trackIds: number[], tagName: string) => write('bulkTag', { trackIds, tagName }),
    bulkRemoveTag: (trackIds: number[], tagId: number) => write('bulkRemoveTag', { trackIds, tagId }),
    bulkDelete: (trackIds: number[]) => write('bulkDelete', { trackIds }),
    toggleTrackType: (trackId: number) => write('toggleTrackType', { trackId }),
    removeWatchedFolder: (folderPath: string) => write('removeWatchedFolder', { folderPath }),
    saveWaveformPeaks: (trackId: number, resolution: number, peaks: number[], version?: number) => write('saveWaveformPeaks', { trackId, resolution, peaks, version }),
    reclassifyAll: () => write('reclassifyAll'),
    getTracks: (options?: unknown) => read('tracks', options),
    getWatchedFolders: () => read('folders'), getAllTags: () => read('tags'),
    getLibraryStats: () => read('stats'), getStorageStats: () => read('storage'),
    importDroppedPaths: (paths: string[]) => invoke('import_paths', { paths }),
    addWatchedFolder: async (folderPath: string) => {
      const result = await invoke<{ errors: string[] }>('import_paths', { paths: [folderPath] });
      if (result.errors.length) throw new Error(result.errors.join('\n'));
      return read('folders');
    },
    rescanLibrary: () => invoke('rescan_library'),
    openFolderDialog: () => invoke('open_folder_dialog'),
    openFilesDialog: () => invoke('open_files_dialog'),
    getPathForFile: () => '',
    onNativeFileDrag: (callback: (paths: string[] | null, hovering: boolean) => void) => {
      const subscriptions = [
        listen('tauri://drag-enter', () => callback(null, true)),
        listen('tauri://drag-leave', () => callback(null, false)),
        listen<{ paths: string[] }>('tauri://drag-drop', event => callback(event.paths, false)),
      ];
      return () => subscriptions.forEach(unlisten => unlisten());
    },
    onLibraryUpdated: (callback: () => void) => listen('library-updated', callback),
    showQuickLauncher: () => invoke('launcher_window', { action: 'show' }),
    hideQuickLauncher: () => invoke('launcher_window', { action: 'hide' }),
    toggleQuickLauncher: () => invoke('launcher_window', { action: 'toggle' }),
    setQuickLauncherHeight: (height: number) => invoke('launcher_height', { height }),
    getQuickLauncherShortcut: () => invoke('launcher_shortcut'),
    setQuickLauncherShortcut: (shortcut: string) => invoke('set_launcher_shortcut', { shortcut }),
    onQuickLauncherShown: (callback: () => void) => listen('launcher-shown', callback),
    onQuickLauncherHidden: (callback: () => void) => listen('launcher-hidden', callback),
    checkAccessibilityPermission: (prompt = false) => invoke('accessibility', { prompt }),
    openAccessibilitySettings: () => invoke('open_accessibility'),
    onAccessibilityStatusChanged: (callback: (data: {granted:boolean}) => void) => listen('accessibility-changed', callback),
    logDrag: () => {},
    checkDownloaderStatus: () => media('status'),
    installDownloader: () => media('install', {ffOnly: false}),
    installFfmpeg: () => media('install', {ffOnly: true}),
    fetchMediaInfo: (url: string) => media('info', {url}),
    startAudioDownload: (options: Parameters<ElectronAPI['startAudioDownload']>[0]) => media('download', options),
    cancelAudioDownload: (jobId: string) => media('cancel', {jobId}),
    onDownloadProgress: (cb: Parameters<ElectronAPI['onDownloadProgress']>[0]) => listen('download-progress', cb),
    onDownloaderInstallProgress: (cb: Parameters<ElectronAPI['onDownloaderInstallProgress']>[0]) => listen('download-install-progress', cb),
    capcut: {
      getPresetsPath: () => capcut('getPresetsPath'),
      scanPresets: (customPath?: string) => capcut('scanPresets', {customPath}),
      analyzeFont: ({folderPath}: {folderPath: string}) => capcut('analyzeFont', {folderPath}),
      fixFonts: ({folderPath}: {folderPath: string}) => capcut('fixFonts', {folderPath}),
      deletePreset: (folderPath: string) => capcut('deletePreset', {folderPath}),
      renamePreset: (folderPath: string, newName: string) => capcut('renamePreset', {folderPath, newName}),
      openFolder: (folderPath: string) => capcut('openFolder', {folderPath}),
      exportPreset: (folderPath: string) => capcut('exportPreset', {folderPath}),
      getAssetDataUrl: (filePath: string) => capcut('getAssetDataUrl', {filePath}),
      listProjects: () => capcut('listProjects'),
      injectPreset: (folderPath: string, target: string, startTimeMs?: number) => capcut('injectPreset', {folderPath, target, startTimeMs}),
      createDraft: (folderPath: string, customName?: string) => capcut('createDraft', {folderPath, customName}),
    },
  };
  host.api = new Proxy(bridge, { get: (target, name) => Reflect.has(target, name) ? Reflect.get(target, name) : unsupported(String(name)) }) as unknown as ElectronAPI;
}
