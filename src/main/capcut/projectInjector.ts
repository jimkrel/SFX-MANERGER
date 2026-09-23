import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CapCutProjectSummary {
  id: string;
  name: string;
  folderPath: string;
  jsonPath: string;
  coverPath: string;
  lastModifiedMs: number;
  durationMs: number;
}

export interface InjectResult {
  success: boolean;
  projectName?: string;
  tracksAdded?: number;
  error?: string;
}

export interface CreateDraftResult {
  success: boolean;
  projectName?: string;
  projectFolder?: string;
  error?: string;
}

// ─── Project Discovery ────────────────────────────────────────────────────────

export function getCapCutDraftsRootDir(): string {
  const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  return path.join(localAppData, 'CapCut', 'User Data', 'Projects', 'com.lveditor.draft');
}

export async function listCapCutProjects(): Promise<CapCutProjectSummary[]> {
  const rootMetaPath = path.join(getCapCutDraftsRootDir(), 'root_meta_info.json');
  if (!fs.existsSync(rootMetaPath)) return [];

  try {
    const raw = fs.readFileSync(rootMetaPath, 'utf8');
    const data = JSON.parse(raw);
    const store = data.all_draft_store || [];

    const projects: CapCutProjectSummary[] = [];

    for (const item of store) {
      const jsonFile = item.draft_json_file;
      if (!jsonFile || !fs.existsSync(jsonFile)) continue;

      // tm_draft_modified is in microseconds
      const modifiedUs = item.tm_draft_modified || item.tm_draft_create || 0;
      const modifiedMs = Math.round(Number(modifiedUs) / 1000);

      // tm_duration is in microseconds
      const durationUs = item.tm_duration || 0;
      const durationMs = Math.round(Number(durationUs) / 1000);

      projects.push({
        id: item.draft_id || path.basename(item.draft_fold_path),
        name: item.draft_name || path.basename(item.draft_fold_path),
        folderPath: item.draft_fold_path,
        jsonPath: jsonFile,
        coverPath: item.draft_cover || '',
        lastModifiedMs: modifiedMs,
        durationMs,
      });
    }

    // Sort newest modified first
    projects.sort((a, b) => b.lastModifiedMs - a.lastModifiedMs);
    return projects;
  } catch (err) {
    console.error('[ProjectInjector] Error listing projects:', err);
    return [];
  }
}

// ─── Extract Preset Materials & Tracks ────────────────────────────────────────

interface ExtractedPresetContent {
  tracks: Record<string, unknown>[];
  materials: Record<string, Record<string, unknown>[]>;
  duration: number; // in microseconds (3,000,000 = 3s)
}

function extractContentFromPresetJson(presetJson: Record<string, unknown>): ExtractedPresetContent {
  let sourceTracks: Record<string, unknown>[] = [];
  let sourceMaterials: Record<string, unknown> = {};
  let duration = 3000000; // default 3s in microseconds

  // 1. Check if combination has subdraft (materials.drafts[0].draft)
  const drafts = (presetJson.materials as Record<string, unknown>)?.drafts as Record<string, unknown>[] | undefined;
  if (drafts && drafts.length > 0 && drafts[0].draft && typeof drafts[0].draft === 'object') {
    const subDraft = drafts[0].draft as Record<string, unknown>;
    sourceTracks = (subDraft.tracks as Record<string, unknown>[]) || [];
    sourceMaterials = (subDraft.materials as Record<string, unknown>) || {};
    if (typeof subDraft.duration === 'number' && subDraft.duration > 0) {
      duration = subDraft.duration;
    }
  } else {
    // Top level tracks
    sourceTracks = (presetJson.tracks as Record<string, unknown>[]) || [];
    sourceMaterials = (presetJson.materials as Record<string, unknown>) || {};
    if (typeof presetJson.duration === 'number' && presetJson.duration > 0) {
      duration = presetJson.duration;
    }
  }

  // Filter for text and effect tracks (skip placeholder video track)
  const validTracks = sourceTracks.filter((t) => {
    const type = t.type as string;
    const segs = t.segments as Record<string, unknown>[] | undefined;
    return (type === 'text' || type === 'effect' || type === 'sticker') && segs && segs.length > 0;
  });

  // Material categories to copy
  const materialKeys = [
    'texts',
    'material_animations',
    'video_effects',
    'effects',
    'stickers',
    'speeds',
    'placeholder_infos',
    'canvases',
    'chromas',
  ];

  const gatheredMaterials: Record<string, Record<string, unknown>[]> = {};
  for (const key of materialKeys) {
    const items = (sourceMaterials[key] as Record<string, unknown>[]) || [];
    if (items.length > 0) {
      gatheredMaterials[key] = items;
    }
  }

  return {
    tracks: validTracks.length > 0 ? validTracks : sourceTracks,
    materials: gatheredMaterials,
    duration,
  };
}

// ─── 1. Inject Preset into Existing Project ───────────────────────────────────

export async function injectPresetIntoProject(
  presetFolderPath: string,
  targetProjectJsonPath: string,
  startTimeMs = 0
): Promise<InjectResult> {
  try {
    const presetDraftJsonPath = path.join(presetFolderPath, 'preset_draft', 'draft_content.json');
    if (!fs.existsSync(presetDraftJsonPath)) {
      return { success: false, error: 'Không tìm thấy draft_content.json của preset' };
    }
    if (!fs.existsSync(targetProjectJsonPath)) {
      return { success: false, error: 'Không tìm thấy file dự án đích: ' + targetProjectJsonPath };
    }

    const presetJson = JSON.parse(fs.readFileSync(presetDraftJsonPath, 'utf8'));
    const targetJson = JSON.parse(fs.readFileSync(targetProjectJsonPath, 'utf8'));

    const { tracks: newTracks, materials: newMaterials } = extractContentFromPresetJson(presetJson);
    if (newTracks.length === 0) {
      return { success: false, error: 'Preset không có track text hoặc effect nào để chèn' };
    }

    // Backup target project
    const backupPath = targetProjectJsonPath + '.bak';
    fs.writeFileSync(backupPath, JSON.stringify(targetJson, null, 2), 'utf8');

    // Ensure target materials exists
    if (!targetJson.materials) targetJson.materials = {};

    // Merge materials without duplicates
    for (const [category, items] of Object.entries(newMaterials)) {
      if (!targetJson.materials[category]) {
        targetJson.materials[category] = [];
      }
      const existingList = targetJson.materials[category] as Record<string, unknown>[];
      const existingIds = new Set(existingList.map((m) => m.id as string));

      for (const item of items) {
        if (!existingIds.has(item.id as string)) {
          existingList.push(item);
          existingIds.add(item.id as string);
        }
      }
    }

    // Calculate start time in microseconds (1 ms = 1000 us)
    const startUs = Math.round(startTimeMs * 1000);

    // Deep clone tracks and adjust time range
    let tracksAdded = 0;
    if (!targetJson.tracks) targetJson.tracks = [];

    for (const track of newTracks) {
      const clonedTrack = JSON.parse(JSON.stringify(track)) as Record<string, unknown>;
      // Give track a unique ID to avoid timeline collisions
      clonedTrack.id = crypto.randomUUID().toUpperCase();

      const segs = clonedTrack.segments as Record<string, unknown>[] | undefined;
      if (segs) {
        for (const seg of segs) {
          seg.id = crypto.randomUUID().toUpperCase();
          const targetTr = seg.target_timerange as Record<string, unknown> | undefined;
          if (targetTr && typeof targetTr.duration === 'number') {
            targetTr.start = startUs;
          }
        }
      }

      targetJson.tracks.push(clonedTrack);
      tracksAdded++;
    }

    // Save modified project file
    fs.writeFileSync(targetProjectJsonPath, JSON.stringify(targetJson, null, 2), 'utf8');

    return {
      success: true,
      projectName: path.basename(path.dirname(targetProjectJsonPath)),
      tracksAdded,
    };
  } catch (err) {
    console.error('[ProjectInjector] Inject failed:', err);
    return { success: false, error: String(err) };
  }
}

// ─── 2. Create Instant Draft Project from Preset ─────────────────────────────

export async function createDraftProjectFromPreset(
  presetFolderPath: string,
  customName?: string
): Promise<CreateDraftResult> {
  try {
    const presetDraftJsonPath = path.join(presetFolderPath, 'preset_draft', 'draft_content.json');
    if (!fs.existsSync(presetDraftJsonPath)) {
      return { success: false, error: 'Không tìm thấy draft_content.json của preset' };
    }

    // Determine project name
    const presetName = customName || path.basename(presetFolderPath);
    const projectName = `[PRESET] ${presetName}`;
    const draftsRoot = getCapCutDraftsRootDir();
    const newProjectFolder = path.join(draftsRoot, projectName);

    // Create project directory
    if (!fs.existsSync(newProjectFolder)) {
      fs.mkdirSync(newProjectFolder, { recursive: true });
    }

    // Read preset draft JSON
    const presetJson = JSON.parse(fs.readFileSync(presetDraftJsonPath, 'utf8'));
    const { tracks, materials, duration } = extractContentFromPresetJson(presetJson);

    // Build standalone project draft_content.json
    const newDraftId = crypto.randomUUID().toUpperCase();
    const nowUs = Date.now() * 1000;

    const standaloneDraft: Record<string, unknown> = {
      canvas_config: { height: 1080, ratio: 'original', width: 1920 },
      color_space: 0,
      config: {
        adjust_max_index: 1,
        attachment_info: [],
        combination_max_index: 1,
        export_range: [-1, -1],
        extract_audio_last_index: 1,
        lyrics_recognition_id: '',
        lyrics_sync: true,
        lyrics_taskinfo: [],
        maintrack_adsorb: true,
        material_save_mode: 0,
        original_sound_last_index: 1,
        record_audio_last_index: 1,
        sticker_max_index: 1,
        subtitle_keywords_config: null,
        subtitle_template_original_fontsize: 0,
        time_mark_sync: true,
        video_mute: false,
        zoom_info_params: null,
      },
      cover: null,
      create_time: Math.round(Date.now() / 1000),
      draft_type: '',
      duration,
      extra_info: null,
      fps: 30,
      free_render_index_mode_on: false,
      function_assistant_info: null,
      group_container: null,
      id: newDraftId,
      is_drop_frame_timecode: false,
      keyframe_graph_list: [],
      keyframes: { adjusts: [], audios: [], effects: [], filters: [], handwrites: [], stickers: [], texts: [], videos: [] },
      last_modified_platform: { app_id: 3704, app_source: 'lv', app_version: '9.5.0', os: 'windows' },
      lyrics_effects: [],
      materials: {
        ...materials,
        videos: [],
        audios: [],
      },
      mixed_track_mode_on: false,
      mutable_config: null,
      name: projectName,
      new_version: '164.0.0',
      path: '',
      platform: { app_id: 3704, app_source: 'lv', app_version: '9.5.0', os: 'windows' },
      relationships: [],
      render_index_track_mode_on: false,
      retouch_cover: null,
      smart_ads_info: null,
      source: 'default',
      static_cover_image_path: '',
      time_marks: null,
      tracks,
      uneven_animation_template_info: null,
      update_time: Math.round(Date.now() / 1000),
      version: 2,
    };

    // Write draft_content.json into new project folder
    fs.writeFileSync(
      path.join(newProjectFolder, 'draft_content.json'),
      JSON.stringify(standaloneDraft, null, 2),
      'utf8'
    );

    // Copy cover image if available
    const jpegFiles = fs.readdirSync(presetFolderPath).filter((f) => f.endsWith('.jpeg') || f.endsWith('.jpg') || f.endsWith('.png'));
    let coverDstPath = '';
    if (jpegFiles.length > 0) {
      coverDstPath = path.join(newProjectFolder, 'draft_cover.jpg');
      fs.copyFileSync(path.join(presetFolderPath, jpegFiles[0]), coverDstPath);
    }

    // Register project in root_meta_info.json so CapCut Home screen displays it
    const rootMetaPath = path.join(draftsRoot, 'root_meta_info.json');
    if (fs.existsSync(rootMetaPath)) {
      try {
        const rootData = JSON.parse(fs.readFileSync(rootMetaPath, 'utf8'));
        if (!rootData.all_draft_store) rootData.all_draft_store = [];

        // Check if project already in list, if so remove old entry
        rootData.all_draft_store = rootData.all_draft_store.filter(
          (p: Record<string, unknown>) => p.draft_name !== projectName && p.draft_id !== newDraftId
        );

        // Prepend new project at top of list
        rootData.all_draft_store.unshift({
          cloud_draft_cover: false,
          cloud_draft_sync: false,
          draft_cloud_last_action_download: false,
          draft_cloud_purchase_info: '',
          draft_cloud_template_id: '',
          draft_cloud_tutorial_info: '',
          draft_cloud_videocut_purchase_info: '',
          draft_cover: coverDstPath.replace(/\\/g, '/'),
          draft_fold_path: newProjectFolder.replace(/\\/g, '/'),
          draft_id: newDraftId,
          draft_is_ai_shorts: false,
          draft_is_cloud_temp_draft: false,
          draft_is_infinite_canvas_draft: false,
          draft_is_invisible: false,
          draft_is_pippit_draft: false,
          draft_is_web_article_video: false,
          draft_json_file: path.join(newProjectFolder, 'draft_content.json').replace(/\\/g, '/'),
          draft_name: projectName,
          draft_new_version: '164.0.0',
          draft_root_path: draftsRoot.replace(/\\/g, '/'),
          draft_timeline_materials_size: 100000,
          draft_type: '',
          draft_web_article_video_enter_from: '',
          pippit_avatar_url: '',
          pippit_extra_info: '',
          pippit_id: '',
          pippit_user_name: '',
          streaming_edit_draft_ready: true,
          tm_draft_cloud_completed: '',
          tm_draft_cloud_entry_id: -1,
          tm_draft_cloud_modified: 0,
          tm_draft_cloud_parent_entry_id: -1,
          tm_draft_cloud_space_id: -1,
          tm_draft_cloud_user_id: -1,
          tm_draft_create: nowUs,
          tm_draft_modified: nowUs,
          tm_draft_removed: 0,
          tm_duration: duration,
        });

        rootData.draft_ids = (rootData.draft_ids || 0) + 1;
        fs.writeFileSync(rootMetaPath, JSON.stringify(rootData), 'utf8');
      } catch (metaErr) {
        console.warn('[ProjectInjector] Could not update root_meta_info.json:', metaErr);
      }
    }

    return {
      success: true,
      projectName,
      projectFolder: newProjectFolder,
    };
  } catch (err) {
    console.error('[ProjectInjector] createDraftProjectFromPreset failed:', err);
    return { success: false, error: String(err) };
  }
}
