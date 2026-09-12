# SFX Music Manager

**SFX & Music Manager** — Phần mềm quản lý thư viện âm thanh và hiệu ứng (SFX) chuyên nghiệp cho các Editor video trên macOS (Apple Silicon).

---

## ✨ Tính Năng Nổi Bật

- **🎧 Preview Siêu Nhanh**: Tự động trích xuất waveform và playhead đồng bộ tức thì, nghe thử bằng phím cách (`Space`).
- **⇄ Kéo & Thả 2 Chiều (Two-Way Drag & Drop)**:
  - **Import**: Kéo thả file/thư mục âm thanh từ Finder vào bất kỳ vị trí nào trên ứng dụng hoặc dùng nút **"+ Thêm File"** / **"+ Thêm Thư Mục"**.
  - **Export**: Kéo trực tiếp clip từ danh sách thả thẳng vào timeline của **Adobe Premiere Pro**, **DaVinci Resolve**, hoặc Finder.
- **🔍 Tìm Kiếm FTS5 Thông Minh**: Full-Text Search siêu tốc với phím tắt `/`, hỗ trợ tìm theo tên clip và phân loại tag.
- **🏷️ Quản Lý Tags Linh Hoạt**: Hệ thống tag nhiều-nhiều với bộ lọc chế độ `AND` / `OR`.
- **⚡ Tối Ưu Hiệu Năng & Bộ Nhớ**: Waveform caching trong SQLite, LRU Buffer Cache, Canvas requestAnimationFrame độc lập.
- **💾 Quản Lý Ổ Đĩa Rời / Missing Status**: Tự động phát hiện khi file hoặc ổ cứng ngoài bị ngắt kết nối (`MISSING`) và tự phục hồi (`ONLINE`) khi cắm lại.
- **🎵 Hỗ Trợ Định Dạng Phong Phú**: `.wav`, `.mp3`, `.aiff`, `.aif`, `.flac`, `.m4a`, `.aac`, `.ogg`, `.caf`.

---

## 🛠️ Công Nghệ Sử Dụng

- **Framework**: Electron + React 18 + TypeScript + Vite
- **Database**: SQLite (better-sqlite3) với WAL mode & FTS5
- **File Watcher**: Chokidar v4
- **Audio Decoding & Metadata**: Web Audio API + music-metadata
- **Target Platform**: macOS Apple Silicon (arm64)

---

## 🚀 Cài Đặt & Phát Triển

### Yêu Cầu Hệ Thống
- macOS (Apple Silicon M1/M2/M3/M4)
- Node.js >= 18

### Khởi Chạy Môi Trường Dev
```bash
npm install
npm run dev
```

### Chạy Toàn Bộ Test Suite (Phase 1–6 + Drag & Drop)
```bash
npm test
```

### Đóng Gói Bộ Cài (.dmg)
```bash
npm run dist
```
File DMG sẽ được tạo tại thư mục `release/SFX Music Manager-1.0.0-arm64.dmg`.

---

## 📄 License
MIT License
