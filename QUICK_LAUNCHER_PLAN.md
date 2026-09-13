# 🚀 SFX QUICK LAUNCHER — KẾ HOẠCH NGHIÊN CỨU & LỘ TRÌNH TRIỂN KHAI (V2)
> **Dự án**: SFX Music Manager (FX Console & Spotlight Edition)  
> **Mục tiêu**: Bật thanh tìm kiếm & kéo thả SFX siêu tốc phủ trên mọi ứng dụng dựng phim (CapCut Desktop, Premiere Pro, DaVinci Resolve) bằng phím tắt toàn hệ thống, với mức tiêu thụ tài nguyên máy **0.0% CPU** khi chạy ngầm.  
> **Ngày lập kế hoạch**: 13/09/2026  
> **Trạng thái**: Đã phê duyệt kiến trúc — Sẵn sàng triển khai  

---

## 📑 MỤC LỤC
1. [Bối Cảnh & Bài Toán Thực Tế Của Video Editor](#1-bối-cảnh--bài-toán-thực-tế-của-video-editor)
2. [Yêu Cầu Kỹ Thuật Cốt Lõi (Non-negotiables)](#2-yêu-cầu-kỹ-thuật-cốt-lõi-non-negotiables)
3. [Kiến Trúc Kỹ Thuật & Các Công Nghệ Áp Dụng](#3-kiến-trúc-kỹ-thuật--các-công-nghệ-áp-dụng)
4. [Thiết Kế UI/UX Chi Tiết (Spotlight & Quick Slots)](#4-thiết-kế-uiux-chi-tiết-spotlight--quick-slots)
5. [Lộ Trình Triển Khai Chi Tiết Theo Từng Phase](#5-lộ-trình-triển-khai-chi-tiết-theo-từng-phase)
6. [Kế Hoạch Kiểm Thử & Nghiệm Thu (Verification Plan)](#6-kế-hoạch-kiểm-thử--nghiệm-thu-verification-plan)

---

## 1. BỐI CẢNH & BÀI TOÁN THỰC TẾ CỦA VIDEO EDITOR

Khi dựng phim hoặc video ngắn (TikTok/Reels/Shorts) trên **CapCut Desktop**, **Adobe Premiere Pro** hoặc **DaVinci Resolve**, việc chuyển cửa sổ (`Alt+Tab` / `Cmd+Tab`) ra ngoài màn hình để tìm hiệu ứng âm thanh (SFX) gây ra 3 vấn đề nghiêm trọng:
1. **Làm đứt mạch tư duy dựng (Breaks Flow State)**: Mỗi lần rời mắt khỏi timeline để mở thư mục là mất tập trung.
2. **Tốn thời gian với các âm thanh tần suất cao**: Một video ngắn 60 giây cần từ 15–20 SFX (Pop, Whoosh, Swoosh, Hit, Ding). Việc gõ tìm kiếm lặp đi lặp lại những âm thanh quen thuộc là một sự lãng phí thao tác.
3. **Áp lực tài nguyên phần cứng**: Khi timeline đang chứa nhiều layer 4K/6K, màu sắc Lumetri, Fusion clip, bất kỳ phần mềm chạy ngầm nào làm vọt CPU hay rò rỉ RAM đều có thể gây giật khung hình (frame drop) hoặc crash phần mềm dựng.

**Giải pháp**: Xây dựng **SFX Quick Launcher** hoạt động theo mô hình của **Video Copilot FX Console / Raycast**:
* Luôn thường trực dưới dạng daemon siêu nhẹ ở khay hệ thống.
* Bấm phím tắt toàn hệ thống (Global Hotkey) là "thức dậy" ngay tức thì trong 50ms.
* Hiển thị ngay các **SFX được gán trước (Quick Slots)** để kéo thả vào timeline mà **không cần gõ 1 chữ nào**.
* Thả chuột hoặc bấm `Esc` là lập tức "ngủ đông", trả lại 100% tài nguyên cho máy dựng.

---

## 2. YÊU CẦU KỸ THUẬT CỐT LÕI (NON-NEGOTIABLES)

| Tiêu chí | Mục tiêu kỹ thuật | Giải pháp đảm bảo |
| :--- | :--- | :--- |
| **Tiêu hao CPU khi chạy ngầm** | **0.00% CPU tuyệt đối** | Đóng băng Chromium qua `backgroundThrottling: true`, ngắt Web Audio `suspend()`, chỉ giữ Event Hook thụ động từ OS. |
| **Tiêu hao RAM khi chạy ngầm** | **< 35MB RAM** | Hủy buffer cache, không render DOM waveform khi ẩn, chỉ giữ kết nối thụ động SQLite WAL. |
| **Tốc độ thức dậy (Wake-up)** | **< 50ms (Tức thì)** | Cửa sổ được khởi tạo sẵn ở chế độ ẩn (`hide()`), khi bấm phím tắt chỉ gọi `show()` và `focus()`. |
| **Tự do gán phím tắt** | **Đổi phím tùy ý cả Win & Mac** | Input Key Recorder tự động chuẩn hóa Accelerator, hỗ trợ kiểm tra xung đột với phần mềm khác. |
| **Tương thích Kéo Thả** | **CapCut, Premiere, DaVinci** | Native File Drag (`webContents.startDrag`) xuất kèm file chuẩn WAV PCM 16-bit. |

---

## 3. KIẾN TRÚC KỸ THUẬT & CÁC CÔNG NGHỆ ÁP DỤNG

### 3.1. Sơ đồ luồng hoạt động (Lifecycle Architecture)

```
┌────────────────────────────────────────────────────────────────────────┐
│                        TRẠNG THÁI NGỦ ĐÔNG (IDLE)                      │
│   • CPU: 0.0%  |  RAM: ~35MB  |  Audio: Suspended  |  Window: Hidden   │
│   • Lắng nghe thụ động: OS Global Hotkey (RegisterHotKey / NSEvent)    │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ Bấm Hotkey (VD: Ctrl+Shift+Space)
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                     ĐÁNH THỨC CỬA SỔ (WAKE-UP < 50ms)                  │
│   • quickLauncherWindow.show() & .focus()                              │
│   • Load 6 Quick Slots gán sẵn từ SQLite cache                        │
│   • Tự động focus con trỏ vào ô Search Bar                             │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
         ┌──────────────────────────┴──────────────────────────┐
         ▼                                                     ▼
 [TRƯỜNG HỢP 1: DÙNG SFX GÁN SẴN]                  [TRƯỜNG HỢP 2: TÌM SFX MỚI]
  • Rê chuột vào Slot 1-6                          • Gõ từ khóa ("whoosh", "cinematic")
  • Bấm số 1-6 để nghe preview nhanh               • Fuse.js trả về top 5 kết quả sau 5ms
  • Giữ chuột KÉO THẲNG vào Timeline               • Bấm Space nghe preview / Enter để chọn
         │                                                     │
         └──────────────────────────┬──────────────────────────┘
                                    │
                                    │ Thả chuột vào CapCut/Premiere hoặc bấm ESC
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                      TỰ ĐỘNG NGỦ LẠI (DEEP SLEEP)                      │
│   • AudioContext.suspend() (Ngắt luồng âm thanh lập tức)               │
│   • Xóa input query, giải phóng RAM rAF                                │
│   • quickLauncherWindow.hide() ➔ CPU trở về 0.00%                      │
└────────────────────────────────────────────────────────────────────────┘
```

### 3.2. Chi tiết các công nghệ áp dụng:

1. **Electron Multi-Window & Frameless Transparent Window**:
   * Tạo một `BrowserWindow` phụ chuyên dụng:
     ```typescript
     const quickWindow = new BrowserWindow({
       width: 600,
       height: 360,
       show: false,
       frame: false,
       transparent: true,
       alwaysOnTop: true,
       skipTaskbar: true,
       resizable: false,
       webPreferences: {
         preload: path.join(__dirname, '../preload/index.js'),
         backgroundThrottling: true // Cực kỳ quan trọng: Đóng băng JS khi ẩn
       }
     })
     ```
   * Sự kiện `quickWindow.on('blur')` ➔ tự động gọi `quickWindow.hide()` khi người dùng click ra ngoài.

2. **Hệ thống Hotkey Động (Dynamic Global Accelerator)**:
   * Sử dụng `electron.globalShortcut`.
   * Hỗ trợ từ khóa `CommandOrControl` giúp 1 config chạy chuẩn trên cả 2 OS (Mac thành `Cmd`, Win thành `Ctrl`).
   * Kiểm tra xung đột: Nếu `globalShortcut.register` trả về `false`, cảnh báo ngay cho người dùng để đổi phím khác.

3. **Thuật toán Tìm Kiếm Siêu Tốc (Fuzzy Match Engine)**:
   * Áp dụng **Fuse.js**: Nhẹ (~12KB), zero-dependency, chạy in-memory cực nhanh.
   * Gõ sai chính tả hoặc gõ tắt (VD: `whosh`, `cne hit`) vẫn tìm chính xác `Whoosh Fast.wav` và `Cinematic Hit.wav`.

4. **Kéo Thả Trực Tiếp Chuẩn OS (Native Drag & Drop Engine)**:
   * Tái sử dụng `event.sender.startDrag({ file: filePath, icon: iconPath })`.
   * Tự động xuất định dạng **PCM RIFF 16-bit WAV** (đã xây dựng ở Phase trước), đảm bảo CapCut, Premiere Pro, DaVinci Resolve nhận 100% không báo lỗi codec.

5. **Khay Hệ Thống (System Tray Integration)**:
   * Thêm icon khay hệ thống cạnh đồng hồ Windows / Menu bar macOS.
   * Khi đóng cửa sổ chính (Main Window), app không thoát mà thu về Tray để giữ Quick Launcher sẵn sàng hoạt động 24/7.

---

## 4. THIẾT KẾ UI/UX CHI TIẾT (SPOTLIGHT & QUICK SLOTS)

### 4.1. Bố cục cửa sổ Quick Launcher (580px × 340px)
* **Tone màu chủ đạo**: Nền tối Deep Studio (`#181715`), viền hổ phách mỏng (`#C9974E / 30%`), đổ bóng nổi (elevation shadow).
* **Khu vực 1 — Thanh Search (Top)**:
  * Input lớn, placeholder: *"Gõ tìm SFX hoặc nhấn [1-6] để nghe nhanh..."*.
  * Icon kính lúp vàng và phím tắt gợi ý `ESC để đóng`.
* **Khu vực 2 — Bảng Quick Slots (Middle)**:
  * 6 ô Slot đại diện cho 6 SFX ruột được gán trước:
    * `[1] Whoosh Quick`
    * `[2] Paper Pop`
    * `[3] Cinematic Impact`
    * `[4] Camera Shutter`
    * `[5] Mouse Click`
    * `[6] Riser Tension`
  * Mỗi ô có badge số phím tắt `[1]`, tên file, độ dài `(0.8s)`.
  * **Trực tiếp giữ chuột vào ô này và kéo ra ngoài là bắt đầu Drag-and-Drop vào CapCut/Premiere**.
* **Khu vực 3 — Danh Sách Gần Đây / Kết Quả Tìm Kiếm (Bottom)**:
  * Khi chưa gõ: Hiện 3 SFX dùng gần đây nhất.
  * Khi bắt đầu gõ: Hiện danh sách 5 kết quả tìm kiếm với Waveform mini và nút Play/Drag.

### 4.2. Cách gán SFX vào Quick Slots từ Cửa Sổ Chính:
* Trong bảng danh sách SFX của Main Window:
  * Chuột phải vào bất kỳ dòng nào ➔ Menu context: *"Gán vào Quick Slot [1 - 6]"*.
  * Hoặc nắm kéo thả dòng đó vào icon Quick Slot trên thanh công cụ.

---

## 5. LỘ TRÌNH TRIỂN KHAI CHI TIẾT THEO TỪNG PHASE

### 🔹 PHASE 1: Cửa Sổ Nổi & Quản Lý Vòng Đời Ngủ Đông (Deep Sleep)
* [ ] Xây dựng module `src/main/launcherWindow.ts` khởi tạo BrowserWindow trong suốt, không viền, `alwaysOnTop: true`.
* [ ] Thiết lập cơ chế tự ẩn khi mất tiêu điểm: Lắng nghe sự kiện `blur` ➔ gọi `.hide()`.
* [ ] Cấu hình cờ Chromium `backgroundThrottling: true` để CPU về 0.0% khi ẩn.
* [ ] Xây dựng System Tray (`src/main/tray.ts`) với icon và menu điều khiển (Mở App chính / Thoát hẳn).

### 🔹 PHASE 2: Quản Lý Phím Tắt Toàn Cầu Động & Giao Diện Gán Phím
* [ ] Mở rộng bảng `settings` trong database SQLite (`key`, `value`) để lưu phím tắt kích hoạt (mặc định: `CommandOrControl+Shift+Space`).
* [ ] Xây dựng IPC handlers: `shortcut:get`, `shortcut:set`.
* [ ] Kiểm tra tính khả dụng của phím tắt (`globalShortcut.isRegistered`, `globalShortcut.register` validation).
* [ ] Xây dựng component `KeybindingRecorder.tsx` trong giao diện Settings để người dùng click và bấm tổ hợp phím bất kỳ.

### 🔹 PHASE 3: Cơ Sở Dữ Liệu & API Quản Lý Quick Slots (Gán SFX)
* [ ] Tạo bảng SQLite `quick_slots`:
  ```sql
  CREATE TABLE IF NOT EXISTS quick_slots (
    slot_index INTEGER PRIMARY KEY CHECK(slot_index BETWEEN 1 AND 8),
    track_id INTEGER REFERENCES tracks(id) ON DELETE SET NULL,
    custom_label TEXT
  );
  ```
* [ ] Xây dựng IPC handlers trong `src/main/index.ts`:
  * `quickSlot:getAll`: Trả về danh sách kèm thông tin chi tiết của track.
  * `quickSlot:assign(slotIndex, trackId, label)`: Gán track vào slot.
  * `quickSlot:clear(slotIndex)`: Xóa gán.
* [ ] Thêm Context Menu (chuột phải) tại danh sách bài hát trong `App.tsx` để gán nhanh vào Slot 1–6.

### 🔹 PHASE 4: Giao Diện Quick Launcher (UI/UX Spotlight)
* [ ] Cấu hình Router/View trong Vite để load trang `/launcher.html` siêu nhẹ (không load kèm các component nặng của App chính).
* [ ] Thiết kế Component `QuickLauncherApp.tsx`:
  * Ô Search thông minh với autofocus.
  * Lưới 6 ô Quick Slots với hiệu ứng hover và badge số phím tắt.
  * Danh sách kết quả tìm kiếm với thời lượng và tag.
* [ ] Lắng nghe phím số `1` đến `6`: Nhấn phím số là phát preview tức thì âm thanh của slot đó.
* [ ] Phím `Space`: Phát / Tạm dừng preview. Phím `Esc`: Đóng launcher.

### 🔹 PHASE 5: Tích Hợp Tìm Kiếm Mờ (Fuse.js) & Tối Ưu Preview
* [ ] Tích hợp thư viện `fuse.js` để index nhanh danh sách bài hát từ SQLite cache.
* [ ] Tìm kiếm mờ (Fuzzy matching) theo cả Tên file, Category và Tags.
* [ ] Tối ưu hóa AudioContext trong Launcher: Ngắt kết nối ngay khi đóng launcher để nhả driver âm thanh cho CapCut/Premiere.

### 🔹 PHASE 6: Native Drag-and-Drop Trực Tiếp Vào CapCut & NLEs
* [ ] Liên kết sự kiện kéo chuột trên Quick Slot và dòng kết quả tìm kiếm với `window.api.startDrag([track.path])`.
* [ ] Thêm hiệu ứng tự động ẩn launcher ngay khi sự kiện drag bắt đầu (`dragstart`), giúp màn hình thông thoáng để editor thả file chính xác vào track timeline bên dưới.
* [ ] Kiểm thử xuất WAV PCM 16-bit tự động đối với các file gốc là MP3/AAC.

---

## 6. KẾ HOẠCH KIỂM THỬ & NGHIỆM THU (VERIFICATION PLAN)

### 6.1. Kiểm thử hiệu năng & tài nguyên (Resource Benchmark)
* Sử dụng script tự động đo lường bằng `process.getProcessMemoryInfo()` và Windows Task Manager:
  * Khi Launcher đang ngủ: CPU phải duy trì **0.00%**, RAM của tiến trình Launcher không tăng dần theo thời gian (zero memory leak).
  * Đo độ trễ thức dậy (Wake-up latency): Thời gian từ lúc nhấn phím đến khi `window.isFocused()` phải **< 50ms**.

### 6.2. Kiểm thử tương thích phần mềm dựng (Compatibility Matrix)
* **CapCut Desktop (Windows & Mac)**:
  * Thả trực tiếp vào ô Media Import: Nhận diện file ngay.
  * Thả trực tiếp xuống Audio Track trên Timeline: Tự động tạo clip âm thanh tại vị trí con trỏ chuột.
* **Adobe Premiere Pro**:
  * Thả vào Project Panel và kéo thẳng vào Audio Track A1/A2/A3.
* **DaVinci Resolve**:
  * Thả vào Media Pool và kéo thẳng vào Fairlight/Edit Timeline.

### 6.3. Kiểm thử phím tắt (Keybinding & Conflict Test)
* Kiểm thử gán các tổ hợp phím phức tạp: `Alt+Space`, `Ctrl+Shift+X`, `F8`, `Cmd+Shift+S`.
* Thử nghiệm cố tình đăng ký phím tắt đã bị Windows chiếm giữ để xác nhận hệ thống bắt lỗi chuẩn và hiển thị thông báo thân thiện.

---

*Tài liệu này là chuẩn thiết kế kỹ thuật chính thức cho phiên bản SFX Quick Launcher v2.*  
*Toàn bộ các phase sẽ được triển khai tuần tự và kiểm thử nghiêm ngặt trước khi đóng gói release.*
