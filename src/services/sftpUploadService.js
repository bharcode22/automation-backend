const { Client } = require('ssh2');
const path = require('path');
const stream = require('stream');
const { resolveSshConfig } = require('../config/sshConfig');

// Extension mappings for auto-routing
const AUDIO_EXTS = ['.mp3', '.wav', '.flac', '.ogg', '.m4a', '.aac', '.opus', '.wma'];
const VIDEO_EXTS = ['.mp4', '.mkv', '.avi', '.mov', '.webm', '.flv', '.wmv', '.m4v'];
const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp', '.ico'];

/**
 * Determine remote directory and category based on filename
 */
function categorizeFile(filename) {
  const ext = path.extname(filename).toLowerCase();
  if (AUDIO_EXTS.includes(ext)) {
    return { category: 'sounds', remoteDir: '/home/pod/sounds', icon: 'audio', ext };
  }
  if (VIDEO_EXTS.includes(ext)) {
    return { category: 'videos', remoteDir: '/home/pod/videos', icon: 'video', ext };
  }
  if (IMAGE_EXTS.includes(ext)) {
    return { category: 'images', remoteDir: '/home/pod/images', icon: 'image', ext };
  }
  return { category: 'others', remoteDir: '/home/pod', icon: 'file', ext };
}

/**
 * Ensure remote directory exists by executing mkdir -p on remote server
 * Safely consumes stream.resume() and has a fallback timeout.
 */
function ensureRemoteDirectory(conn, dirPath) {
  return new Promise((resolve, reject) => {
    let finished = false;
    const timer = setTimeout(() => {
      if (!finished) {
        finished = true;
        resolve(); // proceed even if mkdir timed out
      }
    }, 6000);

    conn.exec(`mkdir -p "${dirPath}"`, (err, channel) => {
      if (err) {
        clearTimeout(timer);
        return reject(err);
      }
      // MUST consume stream so close event fires
      channel.resume();
      if (channel.stderr) channel.stderr.resume();

      channel.on('close', () => {
        if (!finished) {
          finished = true;
          clearTimeout(timer);
          resolve();
        }
      });

      channel.on('error', (e) => {
        if (!finished) {
          finished = true;
          clearTimeout(timer);
          reject(e);
        }
      });
    });
  });
}

/**
 * Upload a single file buffer to remote server via an existing or new SFTP session
 */
function uploadStreamToFile(sftp, remoteFilePath, fileBuffer, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    let finished = false;
    const timer = setTimeout(() => {
      if (!finished) {
        finished = true;
        reject(new Error(`Pengunggahan file ke ${remoteFilePath} melampaui batas waktu (${Math.round(timeoutMs / 1000)}s)`));
      }
    }, timeoutMs);

    const writeStream = sftp.createWriteStream(remoteFilePath);

    writeStream.on('close', () => {
      if (!finished) {
        finished = true;
        clearTimeout(timer);
        resolve();
      }
    });

    writeStream.on('error', (err) => {
      if (!finished) {
        finished = true;
        clearTimeout(timer);
        reject(err);
      }
    });

    const bufferStream = new stream.PassThrough();
    bufferStream.end(fileBuffer);
    bufferStream.pipe(writeStream);
  });
}

/**
 * Upload one or multiple files to a remote server using a SINGLE SSH / SFTP connection
 *
 * @param {Object} serverConfig - SSH Credentials
 * @param {Array<Object>|Object} files - One or an array of Multer file objects
 * @returns {Promise<Array<Object>>} List of upload outcomes
 */
function uploadFilesToRemoteServer(serverConfig, files) {
  return new Promise((resolve, reject) => {
    const fileList = Array.isArray(files) ? files : [files];
    if (fileList.length === 0) {
      return resolve([]);
    }

    let sshConfig;
    try {
      sshConfig = resolveSshConfig(serverConfig);
    } catch (err) {
      return reject(new Error(`Konfigurasi SSH tidak valid: ${err.message}`));
    }

    const conn = new Client();
    let isHandshakeComplete = false;

    // Handshake connection timeout
    const handshakeTimeout = setTimeout(() => {
      if (!isHandshakeComplete) {
        try { conn.end(); } catch (_) {}
        reject(new Error(`Koneksi SSH ke ${sshConfig.host}:${sshConfig.port} waktu habis (timeout ${sshConfig.readyTimeout || 15000}ms)`));
      }
    }, sshConfig.readyTimeout || 15000);

    conn.on('ready', async () => {
      isHandshakeComplete = true;
      clearTimeout(handshakeTimeout);

      try {
        // Collect all distinct directories needed
        const distinctDirs = new Set(fileList.map((f) => categorizeFile(f.originalname).remoteDir));
        for (const dir of distinctDirs) {
          await ensureRemoteDirectory(conn, dir);
        }

        conn.sftp(async (err, sftp) => {
          if (err) {
            try { conn.end(); } catch (_) {}
            return reject(new Error(`Gagal membuka SFTP: ${err.message}`));
          }

          const results = [];
          for (const file of fileList) {
            const { category, remoteDir } = categorizeFile(file.originalname);
            const safeName = path.basename(file.originalname);
            const remoteFilePath = path.posix.join(remoteDir, safeName);

            // Dynamic transfer timeout based on file size (min 60s, + 1s per 200KB)
            const transferTimeout = Math.max(60000, Math.ceil(file.size / 204800) * 1000);

            try {
              await uploadStreamToFile(sftp, remoteFilePath, file.buffer, transferTimeout);
              results.push({
                success: true,
                filename: safeName,
                category,
                remoteDir,
                remoteFilePath,
                sizeBytes: file.size,
                targetHost: `${sshConfig.username}@${sshConfig.host}:${sshConfig.port}`
              });
            } catch (fileErr) {
              results.push({
                success: false,
                filename: safeName,
                category,
                remoteDir,
                remoteFilePath,
                error: fileErr.message,
                targetHost: `${sshConfig.username}@${sshConfig.host}:${sshConfig.port}`
              });
            }
          }

          try { conn.end(); } catch (_) {}
          resolve(results);
        });
      } catch (err) {
        try { conn.end(); } catch (_) {}
        reject(err);
      }
    });

    conn.on('error', (err) => {
      clearTimeout(handshakeTimeout);
      try { conn.end(); } catch (_) {}
      reject(new Error(`Koneksi SSH error (${sshConfig.host}): ${err.message}`));
    });

    try {
      conn.connect(sshConfig);
    } catch (connErr) {
      clearTimeout(handshakeTimeout);
      reject(new Error(`Kesalahan inisialisasi koneksi SSH: ${connErr.message}`));
    }
  });
}

/**
 * List files inside /home/pod/sounds, /home/pod/videos, or /home/pod/images
 */
function listMediaCategory(serverConfig, category = 'all') {
  return new Promise((resolve, reject) => {
    let sshConfig;
    try {
      sshConfig = resolveSshConfig(serverConfig);
    } catch (err) {
      return reject(err);
    }

    const conn = new Client();
    let isHandled = false;

    const timeout = setTimeout(() => {
      if (!isHandled) {
        isHandled = true;
        try { conn.end(); } catch (_) {}
        reject(new Error('Timeout membaca daftar media'));
      }
    }, sshConfig.readyTimeout || 15000);

    conn.on('ready', () => {
      conn.sftp((err, sftp) => {
        if (err) {
          clearTimeout(timeout);
          try { conn.end(); } catch (_) {}
          return reject(err);
        }

        const dirsToScan = category === 'all'
          ? [
              { category: 'sounds', path: '/home/pod/sounds' },
              { category: 'videos', path: '/home/pod/videos' },
              { category: 'images', path: '/home/pod/images' }
            ]
          : [{ category, path: `/home/pod/${category}` }];

        const results = {};
        let completed = 0;

        dirsToScan.forEach(({ category: cat, path: p }) => {
          sftp.readdir(p, (readErr, list) => {
            if (readErr) {
              results[cat] = [];
            } else {
              results[cat] = (list || [])
                .filter((item) => item.attrs && (item.attrs.mode & 0o40000) === 0) // only files
                .map((item) => ({
                  name: item.filename,
                  size: item.attrs ? item.attrs.size : 0,
                  modifyTime: item.attrs && item.attrs.mtime ? new Date(item.attrs.mtime * 1000) : null
                }));
            }

            completed++;
            if (completed === dirsToScan.length) {
              clearTimeout(timeout);
              try { conn.end(); } catch (_) {}
              if (!isHandled) {
                isHandled = true;
                resolve({
                  targetHost: `${sshConfig.username}@${sshConfig.host}:${sshConfig.port}`,
                  media: results
                });
              }
            }
          });
        });
      });
    });

    conn.on('error', (err) => {
      clearTimeout(timeout);
      if (!isHandled) {
        isHandled = true;
        try { conn.end(); } catch (_) {}
        reject(err);
      }
    });

    try {
      conn.connect(sshConfig);
    } catch (connErr) {
      clearTimeout(timeout);
      if (!isHandled) {
        isHandled = true;
        reject(connErr);
      }
    }
  });
}

module.exports = {
  categorizeFile,
  uploadFilesToRemoteServer,
  listMediaCategory,
  AUDIO_EXTS,
  VIDEO_EXTS,
  IMAGE_EXTS
};
