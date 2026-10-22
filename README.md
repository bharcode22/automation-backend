# SSH Headless Backend Service

Backend mandiri berbasis **Node.js + Express + Socket.IO + ssh2 + Multer** yang berfokus khusus pada operasi SSH ke server remote (POD, VPS, container host), termasuk pengujian koneksi (*handshake*), manajemen kredensial multi-server, interactive PTY web terminal, serta **Smart Media File Uploader via SFTP** dengan auto-routing ke:
* `/home/pod/sounds` (Audio)
* `/home/pod/videos` (Video)
* `/home/pod/images` (Image)

Kredensial SSH disimpan dan dibaca secara otomatis dari berkas:
`backend/credential-ssh.json`

---

## 🚀 Fitur Utama Backend

1. **Smart Media File Uploader via SFTP (`POST /api/ssh/media/upload`)**:
   - Menerima berkas media tunggal maupun banyak (*batch/multi-file*).
   - Otomatis mengidentifikasi kategori berkas (audio/video/image) dan menyimpannya ke folder tujuan yang sesuai di remote POD (`/home/pod/sounds`, `/home/pod/videos`, `/home/pod/images`).
   - Otomatis membuat folder remote (*auto-mkdir*) jika belum tersedia.
   - Mendukung opsi *broadcast upload* ke seluruh POD yang terdaftar di `credential-ssh.json`.
2. **Penyimpanan Kredensial Multi-Server (`credential-ssh.json`)**:
   - Konfigurasi target SSH (host, port, username, password, keyPath) disimpan langsung ke berkas JSON (format array) dan dapat ditambah/diperbarui/dihapus via REST API.
3. **Interactive PTY Web Terminal (WebSocket)**:
   - Sesi shell dua arah berbasis `xterm-256color` melalui Socket.io (mendukung ANSI colors, tab completion, htop, nano, dsb).
4. **Endpoint Uji Koneksi (*Handshake*)**:
   - Mengukur latensi koneksi (ms) dan diagnosa sistem remote (`uname -srm; uptime`).
5. **Metadata Sounds Manager (`GET/POST /api/ssh/metadata`)**:
   - Mengambil, mengedit, dan memvalidasi berkas `/home/pod/sounds/metadata.json` di remote POD.
   - Dilengkapi fitur *Auto-Backup* ke `metadata.json.bak` sebelum penimpaan file serta fitur *Restore*.
   - Mendukung penyimpanan visual per sesi maupun raw JSON code editor.
   - Opsi *broadcast* sinkronisasi ke seluruh POD yang terdaftar.

---

## 📁 Struktur Direktori Backend

```text
backend/
├── credential-ssh.json   # 🔑 Berkas penyimpanan konfigurasi multi-SSH
├── .env                  # Konfigurasi port (5050) & CORS
├── .env.example
├── package.json
└── src/
    ├── config/
    │   └── sshConfig.js  # Loader & Writer multi-credential-ssh.json
    ├── controllers/
    │   ├── sshController.js # Handler HTTP REST API (Config & Test)
    │   ├── mediaController.js # Handler Upload & List Media
    │   └── metadataController.js # Handler GET, POST, Restore metadata.json
    ├── routes/
    │   └── sshRoutes.js  # Route Express (/api/ssh/...)
    ├── services/
    │   ├── socketHandler.js # Pengelola WebSocket Terminal PTY
    │   ├── sshService.js # Core wrapper ssh2 (Handshake)
    │   ├── sftpUploadService.js # Core SFTP Media Streaming & Routing
    │   └── metadataService.js # Core SFTP read/write/backup metadata.json
    └── server.js         # Entry point aplikasi Express & Socket.IO
```

---

## ⚙️ Panduan Menjalankan

### Jalankan Server:
Mode development (auto-reload):
```bash
npm run dev
```

Server aktif di:
* **API Endpoint Info**: `http://localhost:5050`
* **Health Check**: `http://localhost:5050/health`
* **WebSocket Path**: `ws://localhost:5050` (`/socket.io/`)
* **REST Base Route**: `http://localhost:5050/api/ssh/`

---

## 📡 Dokumentasi Endpoint REST API

### 1. Smart Media Uploader
* **POST** `/api/ssh/media/upload`
* **Headers**: `Content-Type: multipart/form-data`
* **Form Data**:
  * `files`: Berkas media (audio, video, gambar)
  * `targetServerId`: ID atau Host server target (opsional)
  * `broadcast`: `true` untuk mengunggah ke semua server terdaftar sekaligus

### 2. Daftar Media di Remote POD
* **GET** `/api/ssh/media/list?target=192.168.199.30&category=all|sounds|videos|images`

### 3. Kredensial Multi-Server SSH
* **GET** `/api/ssh/config`: Ambil daftar server
* **POST** `/api/ssh/config`: Simpan/perbarui server
* **DELETE** `/api/ssh/config/:idOrHost`: Hapus server

### 4. Test Koneksi SSH (Handshake)
* **POST** `/api/ssh/test`
# automation-backend
