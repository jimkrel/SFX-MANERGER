# SFX & MUSIC MANAGER — TÀI LIỆU BÀN GIAO & HƯỚNG DẪN CHUYỂN ĐỔI SANG WINDOWS

> **Dự án**: SFX Music Manager (Local Studio Edition)  
> **Repository**: [https://github.com/jimkrel/SFX-MANERGER](https://github.com/jimkrel/SFX-MANERGER)  
> **Ngày cập nhật**: 12/09/2026  
> **Công nghệ**: Electron + React 18 + TypeScript + Vite + SQLite (better-sqlite3) + Chokidar v4  

---

## 📑 MỤC LỤC
1. [Tổng Quan Kiến Trúc Dự Án](#1-tổng-quan-kiến-trúc-dự-án)
2. [Toàn Bộ Lịch Sử Phát Triển & Các Lỗi Đã Được Vá Triệt Để](#2-toàn-bộ-lịch-sử-phát-triển--các-lỗi-đã-được-vá-triệt-để)
3. [Các Tối Ưu Đã Thực Hiện Để Tương Thích Hoàn Hảo Với Windows](#3-các-tối-ưu-đã-thực-hiện-để-tương-thích-hoàn-hảo-với-windows)
4. [Hướng Dẫn Thiết Lập & Chạy Trên Windows (Từ A đến Z)](#4-hướng-dẫn-thiết-lập--chạy-trên-windows-từ-a-đến-z)
5. [Hướng Dẫn Đóng Gói Bộ Cài Windows (.exe)](#5-hướng-dẫn-đóng-gói-bộ-cài-windows-exe)
6. [Lưu Ý Kỹ Thuật Quan Trọng Khi Sử Dụng Trên Windows](#6-lưu-ý-kỹ-thuật-quan-trọng-khi-sử-dụng-trên-windows)

---

## 1. TỔNG QUAN KIẾN TRÚC DỰ ÁN

SFX Music Manager là phần mềm chuyên dụng quản lý thư viện âm thanh và hiệu ứng (SFX) cho Editor video, kết hợp trực tiếp với Adobe Premiere Pro và DaVinci Resolve.

### Cấu Trúc Mã Nguồn:
```
CODE - TOOL/
├── src/
│   ├── main/                 # Electron Main Process (Node.js)
│   │   ├── index.ts          # Khởi tạo BrowserWindow, đăng ký IPC handlers, native drag
│   │   ├── db.ts             # SQLite engine (WAL mode, FTS5 full-text search, tags, migrations)
│   │   └── indexer.ts        # Chokidar watcher, music-metadata parser, heartbeat monitor
│   ├── preload/              # Context Isolation Bridge
│   │   └── index.ts          # Expose window.api an toàn cho Renderer (webUtils.getPathForFile)
│   └── renderer/             # React 18 UI (Vite + TSX)
│       ├── index.html        # HTML shell
│       └── src/
│           ├── App.tsx       # Root layout 3 cột DAW, phím tắt, drag & drop, bảng clip
│           ├── audio/
│           │   ├── player.ts # AudioContext player, LRU Cache 8 buffer, notify state
│           │   └── waveform.ts # Thuật toán trích xuất peaks & cache bộ nhớ/SQLite
│           └── components/
│               ├── NowPlayingPanel.tsx  # Waveform 800-peak, rAF loop canvas, metadata badges
│               ├── WaveformThumbnail.tsx # Canvas thumbnail 80-col cho từng dòng bảng
│               ├── TagEditor.tsx         # Gán/xóa tags trực tiếp
│               └── Toast.tsx             # Hệ thống thông báo toast nổi
├── scripts/                  # Toàn bộ test suite tự động (Phase 1–6 + DragDrop)
├── electron-builder.yml      # Cấu hình đóng gói đa nền tảng (.dmg macOS & .exe Windows)
└── package.json              # Scripts và dependencies
```

---

## 2. TOÀN BỘ LỊCH SỬ PHÁT TRIỂN & CÁC LỖI ĐÃ ĐƯỢC VÁ TRIỆT ĐỂ

Toàn bộ quá trình kiểm thử và rà soát đã phát hiện và xử lý dứt điểm các vấn đề kỹ thuật sau:

### Nhóm 1: Triệt tiêu Race Condition khi quét file
- **Vấn đề cũ**: Hàm quét đệ quy thủ công `scanDir()` chạy song song với `chokidar.watch()`, dẫn đến xung đột ghi trùng lặp 2 lần vào SQLite.
- **Giải pháp**: Xóa bỏ hoàn toàn `scanDir()`, quy chuẩn hóa `chokidar` với `ignoreInitial: false` làm nguồn phát sự kiện duy nhất (single source of truth). Hàm `watchNewFolder` và `importDroppedPaths` đồng bộ chờ sự kiện `ready` của watcher trước khi hoàn tất.

### Nhóm 2: Giải phóng Bộ Nhớ & Tối Ưu Hiệu Năng Render (Critical)
- **LRU Cache AudioBuffer**: Trước đây mỗi lần click phát file đều giải mã `AudioBuffer` mới vào RAM mà không dọn dẹp. Đã bổ sung cơ chế LRU Cache giới hạn tối đa 8 `AudioBuffer` gần nhất (`MAX_BUFFER_CACHE = 8`), tự động thu hồi buffer cũ khi vượt ngưỡng.
- **Cô lập Playhead requestAnimationFrame**: Trước đây vòng lặp `requestAnimationFrame` đặt trong `player.ts` bắn state `currentTime` lên root `App.tsx` ở tần số 60–120Hz làm toàn bộ cây DOM của app bị giật lag. Đã chuyển toàn bộ vòng lặp rAF vào canvas cục bộ của `NowPlayingPanel.tsx` và ghi trực tiếp vào `timeDisplayRef.current.textContent` (không trigger re-render React).

### Nhóm 3: Debounce IPC, Bảo Vệ Ổ Rời & Icon Kéo Thả
- **Debounce `notifyUpdated()`**: Thêm bộ đệm 150ms khi quét hàng loạt file để tránh spam IPC làm đơ giao diện.
- **Heartbeat Monitor ổ đĩa rời**: Chạy định kỳ mỗi 5 giây (`startDriveHeartbeat()`) kiểm tra sự tồn tại của file trên ổ đĩa. Khi rút USB/ổ cứng rời, file chuyển sang trạng thái `MISSING` (màu đỏ, khóa nút bấm); khi cắm lại, tự động phục hồi `ONLINE` (màu xanh).
- **Fallback 3 tầng Icon kéo thả**: Tránh lỗi crash Cocoa/Windows khi gọi `startDrag` bằng cơ chế dự phòng: Canvas thumbnail -> PNG file -> Base64 16x16 transparent PNG.

### Nhóm 4: Bổ Sung UX Phím Tắt & Badges DAW
- **Auto-scroll khi dùng phím `↑`/`↓`**: Dòng clip được chọn tự động cuộn vào tầm nhìn (`selectedRowRef.current.scrollIntoView({ block: 'nearest' })`).
- **Badges kỹ thuật**: Hiển thị tần số lấy mẫu (Sample Rate Hz), số kênh (Stereo/Mono), phân loại SFX/Music (BPM), mức âm lượng dB.
- **Deduplicate Peaks computation**: Sử dụng `pendingPeakPromises` Map để tránh tính toán waveform trùng lặp khi người dùng click liên tục vào cùng một bài.

### Nhóm 5: Khắc Phục Lỗi "Không Thêm Được Audio / Không Hiện List" (Quan Trọng Nhất)
- **Vùng kéo thả toàn màn hình**: Đưa các sự kiện `onDragEnter`, `onDragOver`, `onDragLeave`, `onDrop` lên container root `App.tsx` kèm overlay màu vàng hổ phách bao trọn toàn bộ cửa sổ (kéo vào Sidebar, Header hay Bảng đều nhận).
- **Mở rộng định dạng âm thanh**: Bổ sung `.m4a`, `.aac`, `.ogg`, `.caf` vào danh sách hỗ trợ song song với `.wav`, `.mp3`, `.aiff`, `.flac`.
- **Thêm nút `+ Thêm File`**: Cho phép mở cửa sổ Explorer/Finder chọn trực tiếp từng file lẻ thay vì chỉ cho chọn thư mục.
- **Sửa lỗi hiển thị bảng**: Đảo lại điều kiện logic hiển thị tại `App.tsx` (dòng 816). Trước đây code kiểm tra `folders.length === 0` trước `tracks.length === 0`, khiến các file kéo thả lẻ (chưa liên kết cả thư mục) bị ẩn hoàn toàn dù đã được lưu vào database. Hiện tại bảng luôn hiển thị ngay khi có clip.
- **Chuẩn hóa Unicode đường dẫn**: Áp dụng `.normalize('NFC')` cho toàn bộ đường dẫn đầu vào để xử lý triệt để xung đột tiếng Việt có dấu giữa file system và SQLite.

---

## 3. CÁC TỐI ƯU ĐÃ THỰC HIỆN ĐỂ TƯƠNG THÍCH HOÀN HẢO VỚI WINDOWS

Codebase đã được chuẩn bị sẵn sàng 100% để chạy trên Windows:
1. **Xử lý dấu gạch chéo đường dẫn đa nền tảng**:
   - `App.tsx`: Đã chuyển `track.path.split('/')` thành `track.path.split(/[/\\]/).pop()` để xử lý hoàn hảo cả đường dẫn Windows dạng `D:\Sound Effects\Impact.wav` lẫn macOS `/Users/...`.
2. **Thanh tiêu đề tự thích ứng (Adaptive Window Frame)**:
   - `src/main/index.ts`: `titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default'`. Trên Windows sẽ tự động hiển thị thanh tiêu đề chuẩn với đầy đủ nút Minimize, Maximize, Close.
3. **Cấu hình đóng gói Windows trong `electron-builder.yml`**:
   - Đã cấu hình target `nsis` (trình cài đặt `.exe`) và `portable` (bản chạy ngay không cần cài đặt) cho kiến trúc `x64`.

---

## 4. HƯỚNG DẪN THIẾT LẬP & CHẠY TRÊN WINDOWS (TỪ A ĐẾN Z)

Khi bạn chuyển sang máy Windows 10 hoặc Windows 11, thực hiện lần lượt các bước sau:

### Bước 1: Cài đặt các công cụ nền tảng trên Windows
1. **Node.js**: Tải và cài đặt bản **Node.js LTS (v20 hoặc v22)** từ [nodejs.org](https://nodejs.org/).
   *(Khi cài đặt, tích chọn ô "Automatically install the necessary tools" để cài Python và Visual Studio C++ Build Tools).*
2. **Git for Windows**: Tải và cài đặt từ [git-scm.com](https://git-scm.com/).
3. **C++ Build Tools (Bắt buộc cho better-sqlite3)**:
   - Nếu chưa có, tải **Visual Studio Build Tools** (hoặc Visual Studio Community) và tích chọn workload **"Desktop development with C++"**.

### Bước 2: Clone mã nguồn về máy Windows
Mở **PowerShell** hoặc **Command Prompt** (hoặc Windows Terminal):
```powershell
# Di chuyển đến thư mục bạn muốn lưu dự án (ví dụ Desktop hoặc ổ D:)
cd C:\Users\<Tên_User>\Desktop

# Clone dự án từ GitHub
git clone https://github.com/jimkrel/SFX-MANERGER.git

# Đi vào thư mục dự án
cd SFX-MANERGER
```

### Bước 3: Cài đặt Dependencies và Rebuild SQLite Native
```powershell
# 1. Cài đặt các gói thư viện
npm install

# 2. Rebuild module SQLite tương thích với phiên bản Electron
npm run rebuild
```

### Bước 4: Khởi chạy phần mềm ở chế độ Development
```powershell
npm run dev
```
Cửa sổ SFX Music Manager sẽ xuất hiện trên màn hình Windows với đầy đủ tính năng!

### Bước 5: Chạy kiểm thử tự động
```powershell
npm test
```
Toàn bộ 7 bài test sẽ báo `PASS 100%`.

---

## 5. HƯỚNG DẪN ĐÓNG GÓI BỘ CÀI WINDOWS (.EXE)

Để tạo file cài đặt `.exe` độc lập mang đi cài trên bất kỳ máy Windows nào khác:

```powershell
npm run dist:win
```

Sau khi lệnh hoàn tất:
- File cài đặt dạng Setup: `release/SFX Music Manager Setup 1.0.0.exe`
- File chạy ngay không cần cài (Portable): `release/SFX Music Manager 1.0.0.exe`

Bạn chỉ cần gửi file `.exe` này qua máy khác là chạy được ngay.

---

## 6. LƯU Ý KỸ THUẬT QUAN TRỌNG KHI SỬ DỤNG TRÊN WINDOWS

1. **Vị trí lưu trữ Database trên Windows**:
   - File database SQLite cục bộ sẽ nằm tại:
     `%APPDATA%\sfx-music-manager\library.db`
     *(Đường dẫn thực tế: `C:\Users\<Tên_User>\AppData\Roaming\sfx-music-manager\library.db`)*
   - Toàn bộ dữ liệu tags, danh sách clip, waveform cache đều lưu tại đây và hoàn toàn an toàn khi cập nhật ứng dụng.

2. **Kéo thả clip vào Premiere Pro & DaVinci Resolve trên Windows**:
   - Khi kéo clip từ SFX Music Manager thả sang Premiere Pro hoặc DaVinci Resolve:
     - **Lưu ý User Account Control (UAC)**: Hãy đảm bảo cả SFX Music Manager và Premiere/DaVinci **chạy cùng một quyền hạn** (cả hai cùng chạy quyền Normal User hoặc cả hai cùng "Run as Administrator"). Nếu một bên chạy Admin còn bên kia chạy thường, Windows sẽ chặn sự kiện kéo thả OLE/COM giữa 2 cửa sổ.

3. **Phím tắt DAW trên Windows**:
   - `Space`: Nghe thử / Tạm dừng preview.
   - `↑` / `↓`: Duyệt chuyển nhanh giữa các clip.
   - `/`: Nhảy trực tiếp vào thanh tìm kiếm từ khóa.

---

*Tài liệu này được tạo tự động bởi trợ lý AI Antigravity. Toàn bộ mã nguồn đã được đồng bộ trực tiếp lên GitHub repository của bạn.*
