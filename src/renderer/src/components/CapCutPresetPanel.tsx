import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  Layers,
  Search,
  X,
  RefreshCw,
  AlertTriangle,
  CheckCircle,
  Trash2,
  FolderOpen,
  Download,
  Edit2,
  Check,
  ChevronDown,
  Type,
  Sparkles,
  Clock,
  SortAsc,
  Play,
  Eye,
  Sliders
} from 'lucide-react';
import { CapCutPreset, CapCutTextLayer } from '../../../preload';
import { CapCutAnimPreview, AnimStyleType } from './CapCutAnimPreview';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDate(ms: number): string {
  if (!ms) return '—';
  const d = new Date(ms);
  return d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function colorToCss(color: number[]): string {
  if (!color || color.length < 3) return '#ffffff';
  const r = Math.round(color[0] * 255);
  const g = Math.round(color[1] * 255);
  const b = Math.round(color[2] * 255);
  return `rgb(${r},${g},${b})`;
}

function truncate(str: string, max: number): string {
  return str.length > max ? str.slice(0, max) + '…' : str;
}

type SortBy = 'newest' | 'oldest' | 'name';

// ─── Sub-components ───────────────────────────────────────────────────────────

function TextLayerPreview({ texts }: { texts: CapCutTextLayer[] }) {
  if (texts.length === 0) return <span style={{ color: '#555', fontSize: 11 }}>Không có text layer</span>;
  return (
    <div className="cc-text-layers">
      {texts.slice(0, 4).map((t) => (
        <div key={t.id} className="cc-text-layer-row" title={t.parsedText}>
          <span
            className="cc-text-dot"
            style={{ background: colorToCss(t.color) }}
          />
          <span className="cc-text-content" style={{ fontWeight: t.bold ? 700 : 400 }}>
            {truncate(t.parsedText || '(text trống)', 28)}
          </span>
          {t.isFontBroken && t.fontFilename && (
            <span className="cc-font-warn" title={`Font broken: ${t.fontFilename}`}>
              <AlertTriangle size={10} />
            </span>
          )}
        </div>
      ))}
      {texts.length > 4 && (
        <span style={{ fontSize: 10, color: '#666' }}>+{texts.length - 4} layer nữa</span>
      )}
    </div>
  );
}

function EffectBadge({ name, type }: { name: string; type: string }) {
  const colorMap: Record<string, string> = {
    video_effect: '#8b5cf6',
    mask: '#3b82f6',
    sticker: '#f59e0b',
  };
  return (
    <span
      className="cc-effect-badge"
      style={{ background: colorMap[type] || '#444' }}
      title={`${type}: ${name}`}
    >
      {truncate(name, 14)}
    </span>
  );
}

// ─── Preset Card ──────────────────────────────────────────────────────────────

interface PresetCardProps {
  preset: CapCutPreset;
  isSelected: boolean;
  isFixing: boolean;
  onSelect: (p: CapCutPreset) => void;
  onFixFonts: (p: CapCutPreset) => void;
  onDelete: (p: CapCutPreset) => void;
  onOpenFolder: (p: CapCutPreset) => void;
  onExport: (p: CapCutPreset) => void;
  onRename: (p: CapCutPreset, name: string) => void;
}

function PresetCard({
  preset, isSelected, isFixing,
  onSelect, onFixFonts, onDelete, onOpenFolder, onExport, onRename
}: PresetCardProps) {
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameVal, setRenameVal] = useState(preset.name);
  const [isHovered, setIsHovered] = useState(false);
  const [isLivePin, setIsLivePin] = useState(false);
  const [thumbDataUrl, setThumbDataUrl] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    if (preset.thumbnailPath && window.api?.capcut?.getAssetDataUrl) {
      window.api.capcut.getAssetDataUrl(preset.thumbnailPath).then((url) => {
        if (!cancelled && url) setThumbDataUrl(url);
      });
    }
    return () => { cancelled = true; };
  }, [preset.thumbnailPath]);

  const handleRenameSubmit = useCallback(() => {
    const trimmed = renameVal.trim();
    if (trimmed && trimmed !== preset.name) {
      onRename(preset, trimmed);
    }
    setIsRenaming(false);
  }, [renameVal, preset, onRename]);

  useEffect(() => {
    if (isRenaming) inputRef.current?.focus();
  }, [isRenaming]);

  return (
    <article
      className={`cc-preset-card ${isSelected ? 'selected' : ''} ${preset.hasBrokenFonts ? 'has-broken-fonts' : ''}`}
      onClick={() => onSelect(preset)}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Thumbnail or Live Animation Preview */}
      <div className="cc-card-thumb">
        {isHovered || isLivePin ? (
          <CapCutAnimPreview
            preset={preset}
            isPlaying={true}
            compact
          />
        ) : thumbDataUrl || preset.thumbnailPath ? (
          <img
            src={thumbDataUrl || `file://${preset.thumbnailPath}`}
            alt={preset.name}
            className="cc-thumb-img"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = 'none';
            }}
          />
        ) : (
          <div className="cc-thumb-placeholder">
            <Layers size={28} />
          </div>
        )}

        {/* Live Anim / Cover toggle */}
        <button
          className={`cc-card-preview-toggle ${isLivePin ? 'active' : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            setIsLivePin((p) => !p);
          }}
          title={isLivePin ? 'Chuyển về xem ảnh bìa tĩnh' : 'Xem hoạt ảnh chữ trực tiếp'}
        >
          {isLivePin ? <Eye size={10} /> : <Play size={10} />}
          <span>{isLivePin ? 'Live' : 'Anim'}</span>
        </button>

        {/* Font broken badge overlay */}
        {preset.hasBrokenFonts && (
          <div className="cc-font-broken-badge" title={`${preset.brokenFontCount} font bị broken`}>
            <AlertTriangle size={11} />
            <span>{preset.brokenFontCount}</span>
          </div>
        )}
        {/* Version badge */}
        <div className="cc-version-badge">v{preset.draftVersion?.split('.')[0]}</div>
      </div>

      {/* Info */}
      <div className="cc-card-info">
        {/* Name row */}
        <div className="cc-card-name-row">
          {isRenaming ? (
            <input
              ref={inputRef}
              className="cc-rename-input"
              value={renameVal}
              onChange={(e) => setRenameVal(e.target.value)}
              onBlur={handleRenameSubmit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleRenameSubmit();
                if (e.key === 'Escape') { setIsRenaming(false); setRenameVal(preset.name); }
              }}
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <h3 className="cc-card-name" title={preset.name}>{preset.name}</h3>
          )}
          <button
            className="cc-icon-btn"
            onClick={(e) => { e.stopPropagation(); setIsRenaming(true); setRenameVal(preset.name); }}
            title="Đổi tên"
          >
            {isRenaming ? <Check size={12} /> : <Edit2 size={12} />}
          </button>
        </div>

        {/* Date */}
        <div className="cc-card-meta">
          <Clock size={10} />
          <span>{formatDate(preset.createdAt)}</span>
        </div>

        {/* Text layers preview */}
        {preset.texts.length > 0 && <TextLayerPreview texts={preset.texts} />}

        {/* Effects */}
        {preset.effects.length > 0 && (
          <div className="cc-effects-row">
            {preset.effects.slice(0, 3).map((eff) => (
              <EffectBadge key={eff.id} name={eff.name} type={eff.type} />
            ))}
          </div>
        )}

        {/* Actions row */}
        <div className="cc-card-actions" onClick={(e) => e.stopPropagation()}>
          {preset.hasBrokenFonts && (
            <button
              className={`cc-fix-btn ${isFixing ? 'fixing' : ''}`}
              onClick={() => onFixFonts(preset)}
              disabled={isFixing}
              title="Tự động fix font path bị broken"
            >
              {isFixing ? <RefreshCw size={11} className="cc-spin" /> : <CheckCircle size={11} />}
              <span>{isFixing ? 'Đang fix...' : 'Fix Fonts'}</span>
            </button>
          )}
          <button className="cc-icon-btn" onClick={() => onOpenFolder(preset)} title="Mở thư mục">
            <FolderOpen size={12} />
          </button>
          <button className="cc-icon-btn" onClick={() => onExport(preset)} title="Xuất preset (.zip)">
            <Download size={12} />
          </button>
          <button className="cc-icon-btn danger" onClick={() => onDelete(preset)} title="Xóa preset">
            <Trash2 size={12} />
          </button>
        </div>
      </div>
    </article>
  );
}

// ─── Main Panel ───────────────────────────────────────────────────────────────

interface CapCutPresetPanelProps {
  onToast: (msg: string, type?: 'success' | 'error' | 'info') => void;
}

export function CapCutPresetPanel({ onToast }: CapCutPresetPanelProps) {
  const [presets, setPresets] = useState<CapCutPreset[]>([]);
  const [loading, setLoading] = useState(true);
  const [presetsPath, setPresetsPath] = useState('');
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<SortBy>('newest');
  const [selectedPreset, setSelectedPreset] = useState<CapCutPreset | null>(null);
  const [fixingIds, setFixingIds] = useState<Set<string>>(new Set());
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Live preview controls state for detail panel
  const [previewSpeed, setPreviewSpeed] = useState<number>(1);
  const [previewPlaying, setPreviewPlaying] = useState<boolean>(true);
  const [selectedAnimStyle, setSelectedAnimStyle] = useState<AnimStyleType>('auto');
  const [customPreviewText, setCustomPreviewText] = useState<string>('');

  useEffect(() => {
    setCustomPreviewText('');
    setSelectedAnimStyle('auto');
    setPreviewPlaying(true);
  }, [selectedPreset?.id]);

  const loadPresets = useCallback(async (customPath?: string) => {
    setLoading(true);
    try {
      const path = await window.api.capcut.getPresetsPath();
      setPresetsPath(customPath || path);
      const result = await window.api.capcut.scanPresets(customPath);
      setPresets(result);
    } catch (err) {
      onToast('Lỗi khi quét presets: ' + String(err), 'error');
    } finally {
      setLoading(false);
    }
  }, [onToast]);

  useEffect(() => {
    void loadPresets();
  }, [loadPresets]);

  // Filter + sort
  const filteredPresets = React.useMemo(() => {
    let result = presets;
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.effects.some((e) => e.name.toLowerCase().includes(q)) ||
          p.texts.some((t) => t.parsedText.toLowerCase().includes(q))
      );
    }
    switch (sortBy) {
      case 'newest': return [...result].sort((a, b) => b.createdAt - a.createdAt);
      case 'oldest': return [...result].sort((a, b) => a.createdAt - b.createdAt);
      case 'name': return [...result].sort((a, b) => a.name.localeCompare(b.name));
    }
  }, [presets, search, sortBy]);

  const brokenCount = presets.filter((p) => p.hasBrokenFonts).length;

  const handleFixFonts = useCallback(async (preset: CapCutPreset) => {
    setFixingIds((s) => new Set(s).add(preset.id));
    try {
      const result = await window.api.capcut.fixFonts(preset);
      if (result.fixed > 0) {
        onToast(`✅ Fix xong ${result.fixed} file, preset "${preset.name}"`, 'success');
        if (result.stillMissing.length > 0) {
          onToast(`⚠️ Vẫn thiếu font: ${result.stillMissing.join(', ')}`, 'info');
        }
        await loadPresets(presetsPath !== (await window.api.capcut.getPresetsPath()) ? presetsPath : undefined);
      } else {
        onToast(`Không tìm thấy font nào để fix trong "${preset.name}"`, 'info');
      }
    } catch (err) {
      onToast('Lỗi khi fix fonts: ' + String(err), 'error');
    } finally {
      setFixingIds((s) => { const n = new Set(s); n.delete(preset.id); return n; });
    }
  }, [onToast, loadPresets, presetsPath]);

  const handleFixAllFonts = useCallback(async () => {
    const broken = presets.filter((p) => p.hasBrokenFonts);
    for (const preset of broken) {
      await handleFixFonts(preset);
    }
  }, [presets, handleFixFonts]);

  const handleDelete = useCallback(async (preset: CapCutPreset) => {
    if (!window.confirm(`Xóa preset "${preset.name}"?\nHành động này không thể hoàn tác.`)) return;
    setDeletingId(preset.id);
    try {
      const result = await window.api.capcut.deletePreset(preset.folderPath);
      if (result.success) {
        setPresets((prev) => prev.filter((p) => p.id !== preset.id));
        if (selectedPreset?.id === preset.id) setSelectedPreset(null);
        onToast(`Đã xóa preset "${preset.name}"`, 'success');
      } else {
        onToast('Lỗi khi xóa: ' + result.error, 'error');
      }
    } finally {
      setDeletingId(null);
    }
  }, [selectedPreset, onToast]);

  const handleRename = useCallback(async (preset: CapCutPreset, newName: string) => {
    const result = await window.api.capcut.renamePreset(preset.folderPath, newName);
    if (result.success) {
      setPresets((prev) => prev.map((p) => p.id === preset.id ? { ...p, name: newName } : p));
      onToast(`Đã đổi tên thành "${newName}"`, 'success');
    } else {
      onToast('Lỗi khi đổi tên: ' + result.error, 'error');
    }
  }, [onToast]);

  const handleOpenFolder = useCallback(async (preset: CapCutPreset) => {
    await window.api.capcut.openFolder(preset.folderPath);
  }, []);

  const handleExport = useCallback(async (preset: CapCutPreset) => {
    const result = await window.api.capcut.exportPreset(preset.folderPath);
    if (result.success) {
      onToast(`Đã xuất preset ra ${result.path}`, 'success');
    } else if (!result.canceled) {
      onToast('Lỗi khi xuất: ' + result.error, 'error');
    }
  }, [onToast]);

  return (
    <div className="cc-panel">
      {/* Header */}
      <div className="cc-panel-header">
        <div className="cc-panel-title">
          <Layers size={18} />
          <h2>CapCut Preset Manager</h2>
          <span className="cc-count-badge">{presets.length}</span>
        </div>

        {/* Stats row */}
        {!loading && (
          <div className="cc-stats-row">
            {brokenCount > 0 && (
              <div className="cc-stat-broken">
                <AlertTriangle size={12} />
                <span>{brokenCount} preset bị broken font</span>
                <button className="cc-fix-all-btn" onClick={handleFixAllFonts}>
                  Fix All
                </button>
              </div>
            )}
            {brokenCount === 0 && presets.length > 0 && (
              <div className="cc-stat-ok">
                <CheckCircle size={12} />
                <span>Tất cả font OK</span>
              </div>
            )}
          </div>
        )}

        {/* Search + Sort + Refresh */}
        <div className="cc-toolbar">
          <div className="cc-search-box">
            <Search size={13} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Tìm tên, text, effect..."
            />
            {search && (
              <button onClick={() => setSearch('')}><X size={12} /></button>
            )}
          </div>

          <div className="cc-sort-select-wrap">
            <SortAsc size={12} />
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortBy)}
              className="cc-sort-select"
            >
              <option value="newest">Mới nhất</option>
              <option value="oldest">Cũ nhất</option>
              <option value="name">Tên A-Z</option>
            </select>
            <ChevronDown size={11} />
          </div>

          <button
            className="cc-refresh-btn"
            onClick={() => loadPresets()}
            title="Tải lại danh sách preset"
            disabled={loading}
          >
            <RefreshCw size={13} className={loading ? 'cc-spin' : ''} />
          </button>
        </div>

        {/* Path display */}
        <div className="cc-path-row" title={presetsPath}>
          <FolderOpen size={11} />
          <span>{presetsPath || 'Đang tìm...'}</span>
        </div>
      </div>

      {/* Body */}
      <div className="cc-panel-body">
        {loading ? (
          <div className="cc-loading">
            <RefreshCw size={24} className="cc-spin" />
            <p>Đang quét presets CapCut...</p>
          </div>
        ) : filteredPresets.length === 0 ? (
          <div className="cc-empty">
            <Layers size={40} />
            <p>{search ? `Không tìm thấy kết quả cho "${search}"` : 'Không có preset nào'}</p>
            <span>{presetsPath}</span>
          </div>
        ) : (
          <div className="cc-preset-grid">
            {filteredPresets.map((preset) => (
              <PresetCard
                key={preset.id}
                preset={preset}
                isSelected={selectedPreset?.id === preset.id}
                isFixing={fixingIds.has(preset.id) || deletingId === preset.id}
                onSelect={setSelectedPreset}
                onFixFonts={handleFixFonts}
                onDelete={handleDelete}
                onOpenFolder={handleOpenFolder}
                onExport={handleExport}
                onRename={handleRename}
              />
            ))}
          </div>
        )}
      </div>

      {/* Detail sidebar (selected preset) */}
      {selectedPreset && (
        <div className="cc-detail-panel">
          <div className="cc-detail-header">
            <h3>{selectedPreset.name}</h3>
            <button onClick={() => setSelectedPreset(null)}><X size={14} /></button>
          </div>

          <div className="cc-detail-body">
            {/* Live Interactive Preview Box */}
            <div className="cc-detail-preview-box">
              <div className="cc-detail-preview-header">
                <span className="cc-detail-label"><Sparkles size={11} /> Live Animation</span>
                <div className="cc-detail-preview-speed">
                  {[0.5, 1, 1.5, 2].map((s) => (
                    <button
                      key={s}
                      className={`cc-speed-pill ${previewSpeed === s ? 'active' : ''}`}
                      onClick={() => setPreviewSpeed(s)}
                    >
                      {s}x
                    </button>
                  ))}
                </div>
              </div>

              <div className="cc-detail-stage-wrap">
                <CapCutAnimPreview
                  preset={selectedPreset}
                  isPlaying={previewPlaying}
                  overrideText={customPreviewText}
                  overrideAnim={selectedAnimStyle}
                  speed={previewSpeed}
                  showControls
                  onTogglePlay={() => setPreviewPlaying((p) => !p)}
                />
              </div>

              {/* Style selector and custom test text */}
              <div className="cc-detail-anim-settings">
                <div className="cc-detail-anim-row">
                  <span className="cc-detail-sublabel"><Sliders size={11} /> Hiệu ứng:</span>
                  <select
                    className="cc-anim-select"
                    value={selectedAnimStyle}
                    onChange={(e) => setSelectedAnimStyle(e.target.value as AnimStyleType)}
                  >
                    <option value="auto">Tự động (Theo Preset)</option>
                    <option value="bounce-pop">Bounce Pop (Nảy lò xo)</option>
                    <option value="slide-up">Slide Up (Trượt lên mượt)</option>
                    <option value="glow-gold">Glow Gold (Ánh kim vàng)</option>
                    <option value="shimmer-sweep">Shimmer Sweep (Tia quét qua)</option>
                    <option value="blur-fade">Blur Fade (Lấy nét từ mờ)</option>
                    <option value="typewriter">Typewriter (Gõ chữ từng từ)</option>
                    <option value="glitch">Glitch Cyber (Nhiễu điện tử)</option>
                    <option value="stamp-slam">Stamp Slam (Đóng dấu dập)</option>
                    <option value="flip-3d">Flip 3D (Lật không gian)</option>
                  </select>
                </div>

                <div className="cc-detail-anim-row">
                  <span className="cc-detail-sublabel"><Type size={11} /> Thử chữ mẫu:</span>
                  <div className="cc-input-with-clear">
                    <input
                      className="cc-preview-text-input"
                      placeholder="Gõ chữ để test hoạt ảnh..."
                      value={customPreviewText}
                      onChange={(e) => setCustomPreviewText(e.target.value)}
                    />
                    {customPreviewText && (
                      <button
                        className="cc-input-clear-btn"
                        onClick={() => setCustomPreviewText('')}
                        title="Khôi phục chữ gốc của preset"
                      >
                        <X size={11} />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="cc-detail-section">
              <p className="cc-detail-label"><Clock size={11} /> Ngày tạo</p>
              <p className="cc-detail-value">{formatDate(selectedPreset.createdAt)}</p>
            </div>
            <div className="cc-detail-section">
              <p className="cc-detail-label">CapCut Version</p>
              <p className="cc-detail-value">{selectedPreset.draftVersion || '—'}</p>
            </div>

            {selectedPreset.texts.length > 0 && (
              <div className="cc-detail-section">
                <p className="cc-detail-label"><Type size={11} /> Text Layers ({selectedPreset.texts.length})</p>
                {selectedPreset.texts.map((t) => (
                  <div key={t.id} className="cc-detail-font-row">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span className="cc-text-dot" style={{ background: colorToCss(t.color), flexShrink: 0 }} />
                      <span style={{ fontWeight: t.bold ? 700 : 400, color: '#d4cfc9', fontSize: 12 }}>
                        {t.parsedText || '(trống)'}
                      </span>
                    </div>
                    <div className="cc-font-detail-path">
                      <span className={t.isFontBroken ? 'font-broken-text' : 'font-ok-text'}>
                        {t.isFontBroken ? <AlertTriangle size={10} /> : <CheckCircle size={10} />}
                        {t.fontFilename || 'Font mặc định'}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {selectedPreset.effects.length > 0 && (
              <div className="cc-detail-section">
                <p className="cc-detail-label"><Sparkles size={11} /> Effects ({selectedPreset.effects.length})</p>
                {selectedPreset.effects.map((eff) => (
                  <div key={eff.id} className="cc-detail-effect-row">
                    <EffectBadge name={eff.name} type={eff.type} />
                    <span className="cc-detail-eff-id" title={eff.resourceId}>{eff.resourceId?.slice(-8)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
