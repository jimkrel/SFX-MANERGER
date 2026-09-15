use wasm_bindgen::prelude::*;
use serde::{Deserialize, Serialize};
use symphonia::core::codecs::CODEC_TYPE_NULL;
use symphonia::core::formats::FormatOptions;
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::{MetadataOptions, StandardTagKey};
use symphonia::core::probe::Hint;
use symphonia::default::get_probe;

/// Kết quả parse metadata trả về JS
#[derive(Serialize, Deserialize, Debug)]
pub struct AudioMetadata {
    pub duration: Option<f64>,     // giây
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub genre: Option<String>,
    pub sample_rate: Option<u32>,
    pub channels: Option<u8>,
    pub bit_depth: Option<u32>,
    pub bit_rate: Option<u32>,     // bps
    pub codec: Option<String>,
    pub container: Option<String>,
    pub error: Option<String>,
}

/// Đọc metadata từ raw bytes của file audio
/// Được gọi từ Node.js với Buffer.from(fs.readFileSync(path))
#[wasm_bindgen]
pub fn parse_audio_metadata(data: &[u8], extension: &str) -> JsValue {
    let result = parse_internal(data.to_vec(), extension);
    serde_wasm_bindgen::to_value(&result).unwrap_or(JsValue::NULL)
}

fn parse_internal(data: Vec<u8>, extension: &str) -> AudioMetadata {
    // Tạo MediaSourceStream từ owned bytes in-memory
    let cursor = std::io::Cursor::new(data);
    let mss = MediaSourceStream::new(Box::new(cursor), Default::default());

    // Hint định dạng file từ extension
    let mut hint = Hint::new();
    let ext_lower = extension.trim_start_matches('.').to_lowercase();
    hint.with_extension(&ext_lower);

    let format_opts = FormatOptions {
        enable_gapless: false,
        ..Default::default()
    };
    let meta_opts = MetadataOptions::default();

    // Probe định dạng
    let probed = match get_probe().format(&hint, mss, &format_opts, &meta_opts) {
        Ok(p) => p,
        Err(e) => {
            return AudioMetadata {
                error: Some(format!("probe failed: {}", e)),
                ..empty_meta()
            };
        }
    };

    let mut format = probed.format;

    // --- Đọc tags ---
    let mut title: Option<String> = None;
    let mut artist: Option<String> = None;
    let mut album: Option<String> = None;
    let mut genre: Option<String> = None;

    // Tags từ container metadata
    if let Some(metadata_rev) = format.metadata().current() {
        for tag in metadata_rev.tags() {
            match tag.std_key {
                Some(StandardTagKey::TrackTitle) => title = Some(tag.value.to_string()),
                Some(StandardTagKey::Artist) => artist = Some(tag.value.to_string()),
                Some(StandardTagKey::Album) => album = Some(tag.value.to_string()),
                Some(StandardTagKey::Genre) => genre = Some(tag.value.to_string()),
                _ => {}
            }
        }
    }

    // --- Đọc track info ---
    let track = match format.default_track() {
        Some(t) => t,
        None => {
            return AudioMetadata {
                title, artist, album, genre,
                error: Some("no default track".to_string()),
                ..empty_meta()
            };
        }
    };

    let codec_params = &track.codec_params;

    let sample_rate = codec_params.sample_rate;
    let channels = codec_params.channels.map(|c| c.count() as u8);
    let bit_depth = codec_params.bits_per_sample;
    let bit_rate = codec_params.bits_per_coded_sample
        .and_then(|bpc| sample_rate.map(|sr| bpc * sr * channels.unwrap_or(2) as u32));

    // Duration tính từ n_frames / sample_rate
    let duration = match (codec_params.n_frames, sample_rate) {
        (Some(frames), Some(sr)) if sr > 0 => Some(frames as f64 / sr as f64),
        _ => {
            // Fallback: đọc time_base nếu có
            track.codec_params.time_base.and_then(|tb| {
                codec_params.n_frames.map(|f| {
                    f as f64 * tb.numer as f64 / tb.denom as f64
                })
            })
        }
    };

    // Tên codec từ codec type
    let codec_name = if codec_params.codec != CODEC_TYPE_NULL {
        Some(format!("{:?}", codec_params.codec))
    } else {
        None
    };

    // Tên container từ extension
    let container = Some(ext_lower.to_uppercase());

    AudioMetadata {
        duration,
        title,
        artist,
        album,
        genre,
        sample_rate,
        channels,
        bit_depth,
        bit_rate,
        codec: codec_name,
        container,
        error: None,
    }
}

fn empty_meta() -> AudioMetadata {
    AudioMetadata {
        duration: None,
        title: None,
        artist: None,
        album: None,
        genre: None,
        sample_rate: None,
        channels: None,
        bit_depth: None,
        bit_rate: None,
        codec: None,
        container: None,
        error: None,
    }
}
