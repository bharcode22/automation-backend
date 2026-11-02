# SSH Headless Backend Service

Backend mandiri berbasis **Node.js + Express + Socket.IO + ssh2 + Multer** yang berfokus khusus pada orkestrasi dan otomasi remote node **POD** (Linux multimedia box pemutar suara, getaran, visual, dan sesi meditasi). Backend ini menyediakan REST API dan WebSocket untuk pengujian koneksi, manajemen multi-server, streaming SFTP media, manipulasi playlist `metadata.json`, sinkronisasi database PostgreSQL `regenesis`, serta eksekusi skrip pemeliharaan remote.

Kredensial SSH disimpan dan dibaca secara otomatis dari:  
📂 `backend/credential-ssh.json`

---

## 🚀 Fitur Utama Backend

1. **Smart Media File Uploader via SFTP (`POST /api/ssh/media/upload`)**:
   - Mendukung berkas media tunggal maupun banyak (*batch/multi-file*).
   - Otomatis mendeteksi kategori berkas (audio/video/image) dan mengarahkannya ke direktori POD yang tepat:
     - `/home/pod/sounds` (Audio)
     - `/home/pod/videos` (Video)
     - `/home/pod/images` (Image)
   - Otomatis membuat folder remote (*auto-mkdir*) bila belum tersedia.
   - Opsi *broadcast upload* ke seluruh POD yang terdaftar sekaligus.

2. **Manajemen Berkas `metadata.json` Remote**:
   - Membaca, memvalidasi, dan memperbarui `/home/pod/sounds/metadata.json`.
   - Menggunakan penulisan atomik (`.tmp` $\rightarrow$ `.bak` $\rightarrow$ file asli) untuk mencegah file corrupt jika proses terputus.
   - Fitur **Restore** instan dari `metadata.json.bak`.

3. **Sinkronisasi & Regenerasi Metadata dari PostgreSQL (`POST /api/ssh/metadata/generate-from-db`)**:
   - Menghubungi database PostgreSQL `regenesis` di dalam container Docker `postgres-db` pada remote POD.
   - Mengambil data relasional dan merangkainya menjadi 3 domain metadata:
     - **`Sessions`**: Dari tabel `experiences` & `detail_experience` (durasi dalam menit dikonversi ke milidetik).
     - **`Guides`**: Dari tabel `sound_task` (menghasilkan varian `mini`, `less`, `full`).
     - **`SelfDevelopment`**: Dari tabel `self_development_sound` & `self_development` (durasi detik ke milidetik).
   - Menulis langsung ke `/home/pod/sounds/metadata.json` dan memancarkan sinyal `NOTIFY metadata_changed`.

4. **Mutasi Database & Auto-Regenerate Metadata (`POST /api/ssh/database/mutate-and-generate`)**:
   - Menjalankan mutasi SQL (`INSERT`, `UPDATE`, `DELETE`) secara atomik di dalam blok transaksi PostgreSQL `BEGIN ... COMMIT` dengan proteksi `ON_ERROR_STOP=1`.
   - Menggunakan *base64 pipeline execution* untuk mencegah kesalahan karakter (*bash escaping*).
   - Setelah database terupdate, sistem **secara otomatis men-generate ulang** `metadata.json` dan mengirim notifikasi Postgres.

5. **Eksekusi Remote Shell Script (`POST /api/ssh/scripts/run`)**:
   - Menjalankan skrip bash terisolasi di `/home/pod/scripts/exec/` dengan whitelist keamanan:
     - `kill-process.sh`: Mematikan proses multimedia yang macet atau zombie tanpa reboot.
     - `auto-script.sh`: Menjalankan otomasi pemeliharaan berkala atau restart service.
   - Dilengkapi *line-ending normalization* otomatis (`\r\n` $\rightarrow$ `\n`) dan *auto-chmod +x*.

6. **Interactive PTY Web Terminal (WebSocket)**:
   - Sesi shell interaktif dua arah berbasis `xterm-256color` melalui Socket.IO (mendukung ANSI colors, tab completion, htop, nano, resize window).

7. **Multi-SSH Configuration & Health Check**:
   - Resolusi target fleksibel berbasis parameter `name` (misal `"pod 30"`, case-insensitive), `host`, `user@host:port`, atau fallback ke server pertama.
   - Endpoint test handshake untuk memonitor latensi dan diagnosa hardware remote (`uname -srm; uptime`).

---

## 📊 Pemetaan Tabel Database ke `metadata.json`

| Kategori Metadata | Tabel Sumber di PostgreSQL `regenesis` | Relasi Primary / Foreign Key | Kolom Kunci & Konversi | Tipe di `metadata.json` |
| :--- | :--- | :--- | :--- | :--- |
| **Experience** | `experiences`<br/>`detail_experience`<br/>`burst_time` | `experiences.id` = `detail_experience.experience_id`<br/>`detail_experience.id` = `burst_time.fk_detail_experience` | `menu_name`, `sound_scape`, `song` (audio), `lamp` (strobe), `duration` (menit $\times 60.000$ $\rightarrow$ ms) | `"Sessions"` |
| **Self Development** | `self_development`<br/>`self_development_sound` | `self_development.id` = `self_development_sound.self_development_id` | `self_development_name`, `sound_code`, `filepath`, `video`, `lamp`, `duration` (detik $\times 1.000$ $\rightarrow$ ms) | `"SelfDevelopment"` |
| **Guides** | `sound_task` | Mandiri | `sound_task_code`, `sound_little`, `sound_less`, `sound_advance` | `"Guides"` |

---

## 📁 Struktur Direktori Backend

```text
backend/
├── credential-ssh.json        # 🔑 Penyimpanan konfigurasi multi-server SSH
├── .env                       # Pengaturan port (PORT=5051), HOST, dan CORS
├── .env.example
├── package.json
├── Dockerfile
├── docker-compose.yml
└── src/
    ├── config/
    │   └── sshConfig.js       # Loader, resolver, & writer multi-credential SSH
    ├── controllers/
    │   ├── sshController.js      # Handler config SSH & test connection
    │   ├── mediaController.js    # Handler upload & list media SFTP
    │   ├── metadataController.js # Handler metadata & database sync/mutation
    │   └── scriptController.js   # Handler eksekusi shell script remote
    ├── routes/
    │   └── sshRoutes.js       # Definisi seluruh rute Express (/api/ssh/...)
    ├── services/
    │   ├── socketHandler.js      # Sesi interactive PTY terminal (Socket.IO)
    │   ├── sshService.js         # Core SSH2 client, exec command, handshake
    │   ├── sftpUploadService.js  # Core SFTP file streaming & categorization
    │   ├── metadataService.js    # Core read/write metadata, SQL query, & DB mutate
    │   └── scriptService.js      # Core executor shell script remote
    └── server.js              # Entry point Express HTTP & Socket.IO server
```

---

## ⚙️ Panduan Menjalankan

### 1. Menggunakan Docker (Direkomendasikan)
```bash
# Build dan jalankan di background (port dari .env, default 5051)
docker compose up -d --build

# Pantau log aplikasi
docker compose logs -f

# Menghentikan layanan
docker compose down
```

### 2. Menjalankan Langsung via Node.js
```bash
# Install dependencies
npm install

# Mode Development (auto-reload dari src/):
npm run dev

# Mode Build & Production:
npm run build
npm start
```

* **API Health Check**: `http://localhost:5051/health`
* **WebSocket Path**: `ws://localhost:5051` (`/socket.io/`)
* **REST Base Route**: `http://localhost:5051/api/ssh/`

---

## 📡 Katalog Endpoint REST API Lengkap

### 1. Manajemen Kredensial SSH & Health Check
| Method | Endpoint | Deskripsi |
| :--- | :--- | :--- |
| `GET` | `/api/ssh/config` | Mengambil seluruh daftar server yang terdaftar di `credential-ssh.json` |
| `POST` | `/api/ssh/config` | Menambah atau memperbarui profil server SSH |
| `DELETE` | `/api/ssh/config/:idOrHost` | Menghapus server berdasarkan ID, nama, atau host |
| `POST` | `/api/ssh/test` | Menguji handshake koneksi SSH dan memeriksa latensi server |

### 2. Smart Media Uploader (SFTP)
| Method | Endpoint | Deskripsi |
| :--- | :--- | :--- |
| `POST` | `/api/ssh/media/upload` | Unggah media (`files`), auto-route ke sounds/videos/images. Opsi `broadcast: true` |
| `GET` | `/api/ssh/media/list?target=pod 30&category=all` | Melihat daftar berkas media remote pada kategori tertentu |
| `GET` | `/api/ssh/media/detect?filename=sample.mp3` | Mendeteksi kategori dan path tujuan file berdasarkan nama |

### 3. Manajemen Berkas `metadata.json`
| Method | Endpoint | Deskripsi |
| :--- | :--- | :--- |
| `GET` | `/api/ssh/metadata?target=pod 30` | Membaca isi berkas `/home/pod/sounds/metadata.json` |
| `POST` | `/api/ssh/metadata` | Menyimpan konten JSON baru ke `metadata.json` (auto backup ke `.bak`) |
| `POST` | `/api/ssh/metadata/restore` | Mengembalikan file `metadata.json` dari cadangan `metadata.json.bak` |

### 4. Sinkronisasi & Mutasi Database PostgreSQL
| Method | Endpoint | Deskripsi |
| :--- | :--- | :--- |
| `POST` | `/api/ssh/metadata/generate-from-db` | Query PostgreSQL `regenesis`, transform data, tulis ke `metadata.json`, dan kirim `NOTIFY` |
| `POST` | `/api/ssh/metadata/sync-db` | Alias untuk `generate-from-db` |
| `POST` | `/api/ssh/database/mutate-and-generate` | **Eksekusi mutasi SQL (INSERT/UPDATE/DELETE) dalam transaksi `BEGIN...COMMIT` lalu otomatis me-regenerate `metadata.json`** |

#### Contoh Request Mutasi Database & Auto-Regenerate:
```bash
curl -X POST "http://localhost:5051/api/ssh/database/mutate-and-generate" \
  -H "Content-Type: application/json" \
  -d '{
    "targetServerId": "pod 30",
    "sql": "UPDATE experiences SET information = '\''Deskripsi sesi terbaru'\'' WHERE menu_name = '\''Deep Relaxation'\'';",
    "broadcast": false,
    "createBackup": true,
    "regenerate": true
  }'
```

#### Contoh Response:
```json
{
  "success": true,
  "mutatedServersCount": 1,
  "failedServersCount": 0,
  "regenerated": true,
  "totalGeneratedItems": 151,
  "stats": {
    "sessionsCount": 15,
    "guidesCount": 120,
    "selfDevelopmentCount": 16
  },
  "results": [
    {
      "serverName": "pod 30",
      "targetHost": "pod@192.168.199.30:22",
      "totalItems": 151,
      "writtenToFile": true,
      "path": "/home/pod/sounds/metadata.json",
      "dbMutation": {
        "success": true,
        "output": "BEGIN\nUPDATE 1\nCOMMIT",
        "durationMs": 310
      }
    }
  ],
  "message": "Berhasil memperbarui database dan men-generate metadata untuk 1 server POD (151 item)."
}
```

### 5. Eksekusi Shell Script Remote
| Method | Endpoint | Deskripsi |
| :--- | :--- | :--- |
| `POST` | `/api/ssh/scripts/run` | Menjalankan script whitelist (`kill-process.sh` atau `auto-script.sh`) di `/home/pod/scripts/exec/` |
| `GET` | `/api/ssh/scripts/list?target=pod 30` | Melihat daftar script yang tersedia di direktori remote |
