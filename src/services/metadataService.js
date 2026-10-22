const { Client } = require('ssh2');
const path = require('path');
const stream = require('stream');
const { resolveSshConfig } = require('../config/sshConfig');

const REMOTE_SOUNDS_DIR = '/home/pod/sounds';
const REMOTE_METADATA_FILE = '/home/pod/sounds/metadata.json';
const REMOTE_METADATA_BACKUP = '/home/pod/sounds/metadata.json.bak';

/**
 * Read remote /home/pod/sounds/metadata.json
 *
 * @param {Object} serverConfig - Server credentials
 * @returns {Promise<Object>} Result containing parsed JSON and raw content
 */
function readRemoteMetadata(serverConfig) {
  return new Promise((resolve, reject) => {
    let sshConfig;
    try {
      sshConfig = resolveSshConfig(serverConfig);
    } catch (err) {
      return reject(new Error(`Konfigurasi SSH tidak valid: ${err.message}`));
    }

    const conn = new Client();
    let isHandled = false;

    const timeout = setTimeout(() => {
      if (!isHandled) {
        isHandled = true;
        try { conn.end(); } catch (_) {}
        reject(new Error(`Waktu habis saat membaca metadata dari ${sshConfig.host}`));
      }
    }, sshConfig.readyTimeout || 15000);

    conn.on('ready', () => {
      // Check backup existence and read file
      conn.sftp((err, sftp) => {
        if (err) {
          clearTimeout(timeout);
          try { conn.end(); } catch (_) {}
          if (!isHandled) {
            isHandled = true;
            return reject(new Error(`Gagal membuka SFTP: ${err.message}`));
          }
        }

        // Check if backup exists
        sftp.stat(REMOTE_METADATA_BACKUP, (backupErr, backupStat) => {
          const hasBackup = !backupErr && !!backupStat;

          // Now read the metadata file
          sftp.stat(REMOTE_METADATA_FILE, (statErr, stat) => {
            if (statErr) {
              clearTimeout(timeout);
              try { conn.end(); } catch (_) {}
              if (!isHandled) {
                isHandled = true;
                // If file doesn't exist yet, return empty list instead of hard error
                if (statErr.code === 2 || statErr.message.includes('No such file')) {
                  return resolve({
                    exists: false,
                    metadata: [],
                    rawString: '[]',
                    sizeBytes: 0,
                    modifyTime: null,
                    hasBackup: false,
                    targetHost: `${sshConfig.username}@${sshConfig.host}:${sshConfig.port}`
                  });
                }
                return reject(new Error(`Gagal membaca status metadata: ${statErr.message}`));
              }
              return;
            }

            const readStream = sftp.createReadStream(REMOTE_METADATA_FILE);
            const chunks = [];

            readStream.on('data', (chunk) => {
              chunks.push(chunk);
            });

            readStream.on('end', () => {
              clearTimeout(timeout);
              try { conn.end(); } catch (_) {}
              if (!isHandled) {
                isHandled = true;
                const rawString = Buffer.concat(chunks).toString('utf8');
                let parsed = null;
                let isJsonValid = false;

                try {
                  parsed = JSON.parse(rawString);
                  isJsonValid = true;
                } catch (parseErr) {
                  // If corrupted on disk, return rawString so user can fix it
                  parsed = null;
                  isJsonValid = false;
                }

                resolve({
                  exists: true,
                  metadata: parsed,
                  rawString,
                  isJsonValid,
                  sizeBytes: stat.size,
                  modifyTime: stat.mtime ? new Date(stat.mtime * 1000) : null,
                  hasBackup,
                  targetHost: `${sshConfig.username}@${sshConfig.host}:${sshConfig.port}`
                });
              }
            });

            readStream.on('error', (streamErr) => {
              clearTimeout(timeout);
              try { conn.end(); } catch (_) {}
              if (!isHandled) {
                isHandled = true;
                reject(new Error(`Gagal membaca stream metadata: ${streamErr.message}`));
              }
            });
          });
        });
      });
    });

    conn.on('error', (connErr) => {
      clearTimeout(timeout);
      if (!isHandled) {
        isHandled = true;
        try { conn.end(); } catch (_) {}
        reject(new Error(`Koneksi SSH error (${sshConfig.host}): ${connErr.message}`));
      }
    });

    try {
      conn.connect(sshConfig);
    } catch (e) {
      clearTimeout(timeout);
      if (!isHandled) {
        isHandled = true;
        reject(e);
      }
    }
  });
}

/**
 * Write remote /home/pod/sounds/metadata.json with safety backup
 *
 * @param {Object} serverConfig - Server credentials
 * @param {Object|Array|string} content - JSON data to write
 * @param {boolean} createBackup - Whether to backup before writing
 * @returns {Promise<Object>}
 */
function writeRemoteMetadata(serverConfig, content, createBackup = true) {
  return new Promise((resolve, reject) => {
    let sshConfig;
    try {
      sshConfig = resolveSshConfig(serverConfig);
    } catch (err) {
      return reject(new Error(`Konfigurasi SSH tidak valid: ${err.message}`));
    }

    // Validate that content is valid JSON
    let jsonString = '';
    if (typeof content === 'string') {
      try {
        const parsed = JSON.parse(content);
        jsonString = JSON.stringify(parsed, null, 2);
      } catch (err) {
        return reject(new Error(`Sintaks JSON tidak valid: ${err.message}`));
      }
    } else if (typeof content === 'object' && content !== null) {
      jsonString = JSON.stringify(content, null, 2);
    } else {
      return reject(new Error('Konten metadata harus berupa objek, array, atau string JSON valid.'));
    }

    const conn = new Client();
    let isHandled = false;

    const timeout = setTimeout(() => {
      if (!isHandled) {
        isHandled = true;
        try { conn.end(); } catch (_) {}
        reject(new Error(`Waktu habis saat menyimpan metadata ke ${sshConfig.host}`));
      }
    }, (sshConfig.readyTimeout || 15000) + 15000);

    conn.on('ready', () => {
      // 1. Ensure directory exists and create backup if requested
      const backupCmd = createBackup
        ? `mkdir -p "${REMOTE_SOUNDS_DIR}" && [ -f "${REMOTE_METADATA_FILE}" ] && cp "${REMOTE_METADATA_FILE}" "${REMOTE_METADATA_BACKUP}" || true`
        : `mkdir -p "${REMOTE_SOUNDS_DIR}"`;

      conn.exec(backupCmd, (execErr, channel) => {
        if (execErr) {
          clearTimeout(timeout);
          try { conn.end(); } catch (_) {}
          if (!isHandled) {
            isHandled = true;
            return reject(new Error(`Gagal menyiapkan backup: ${execErr.message}`));
          }
          return;
        }

        channel.resume();
        if (channel.stderr) channel.stderr.resume();

        channel.on('close', () => {
          // 2. Open SFTP to write file
          conn.sftp((sftpErr, sftp) => {
            if (sftpErr) {
              clearTimeout(timeout);
              try { conn.end(); } catch (_) {}
              if (!isHandled) {
                isHandled = true;
                return reject(new Error(`Gagal membuka SFTP: ${sftpErr.message}`));
              }
              return;
            }

            const writeStream = sftp.createWriteStream(REMOTE_METADATA_FILE);

            writeStream.on('close', () => {
              clearTimeout(timeout);
              try { conn.end(); } catch (_) {}
              if (!isHandled) {
                isHandled = true;
                resolve({
                  success: true,
                  targetHost: `${sshConfig.username}@${sshConfig.host}:${sshConfig.port}`,
                  backupCreated: createBackup,
                  sizeBytes: Buffer.byteLength(jsonString, 'utf8')
                });
              }
            });

            writeStream.on('error', (wErr) => {
              clearTimeout(timeout);
              try { conn.end(); } catch (_) {}
              if (!isHandled) {
                isHandled = true;
                reject(new Error(`Gagal menulis berkas metadata via SFTP: ${wErr.message}`));
              }
            });

            const bufStream = new stream.PassThrough();
            bufStream.end(Buffer.from(jsonString, 'utf8'));
            bufStream.pipe(writeStream);
          });
        });
      });
    });

    conn.on('error', (connErr) => {
      clearTimeout(timeout);
      if (!isHandled) {
        isHandled = true;
        try { conn.end(); } catch (_) {}
        reject(new Error(`Koneksi SSH error (${sshConfig.host}): ${connErr.message}`));
      }
    });

    try {
      conn.connect(sshConfig);
    } catch (e) {
      clearTimeout(timeout);
      if (!isHandled) {
        isHandled = true;
        reject(e);
      }
    }
  });
}

/**
 * Restore metadata from remote /home/pod/sounds/metadata.json.bak
 *
 * @param {Object} serverConfig - Server credentials
 * @returns {Promise<Object>}
 */
function restoreRemoteMetadata(serverConfig) {
  return new Promise((resolve, reject) => {
    let sshConfig;
    try {
      sshConfig = resolveSshConfig(serverConfig);
    } catch (err) {
      return reject(new Error(`Konfigurasi SSH tidak valid: ${err.message}`));
    }

    const conn = new Client();
    let isHandled = false;

    const timeout = setTimeout(() => {
      if (!isHandled) {
        isHandled = true;
        try { conn.end(); } catch (_) {}
        reject(new Error(`Waktu habis saat memulihkan metadata di ${sshConfig.host}`));
      }
    }, sshConfig.readyTimeout || 15000);

    conn.on('ready', () => {
      const restoreCmd = `[ -f "${REMOTE_METADATA_BACKUP}" ] && cp "${REMOTE_METADATA_BACKUP}" "${REMOTE_METADATA_FILE}" || exit 2`;

      conn.exec(restoreCmd, (execErr, channel) => {
        if (execErr) {
          clearTimeout(timeout);
          try { conn.end(); } catch (_) {}
          if (!isHandled) {
            isHandled = true;
            return reject(new Error(`Gagal mengeksekusi pemulihan: ${execErr.message}`));
          }
          return;
        }

        channel.resume();
        if (channel.stderr) channel.stderr.resume();

        channel.on('close', (code) => {
          clearTimeout(timeout);
          try { conn.end(); } catch (_) {}
          if (!isHandled) {
            isHandled = true;
            if (code === 2) {
              return reject(new Error('Berkas cadangan (metadata.json.bak) tidak ditemukan di server POD.'));
            }
            if (code !== 0) {
              return reject(new Error(`Perintah restore gagal dengan exit code ${code}`));
            }
            resolve({
              success: true,
              message: 'Berkas metadata.json berhasil dipulihkan dari cadangan.',
              targetHost: `${sshConfig.username}@${sshConfig.host}:${sshConfig.port}`
            });
          }
        });
      });
    });

    conn.on('error', (connErr) => {
      clearTimeout(timeout);
      if (!isHandled) {
        isHandled = true;
        try { conn.end(); } catch (_) {}
        reject(new Error(`Koneksi SSH error (${sshConfig.host}): ${connErr.message}`));
      }
    });

    try {
      conn.connect(sshConfig);
    } catch (e) {
      clearTimeout(timeout);
      if (!isHandled) {
        isHandled = true;
        reject(e);
      }
    }
  });
}

/**
 * Trigger PostgreSQL NOTIFY metadata_changed on remote POD
 *
 * @param {Object} serverConfig - Server credentials
 * @returns {Promise<Object>}
 */
function triggerRemoteDatabaseSync(serverConfig) {
  return new Promise((resolve, reject) => {
    let sshConfig;
    try {
      sshConfig = resolveSshConfig(serverConfig);
    } catch (err) {
      return reject(new Error(`Konfigurasi SSH tidak valid: ${err.message}`));
    }

    const conn = new Client();
    let isHandled = false;

    const timeout = setTimeout(() => {
      if (!isHandled) {
        isHandled = true;
        try { conn.end(); } catch (_) {}
        reject(new Error(`Timeout saat memicu sinkronisasi database di ${sshConfig.host}`));
      }
    }, sshConfig.readyTimeout || 15000);

    conn.on('ready', () => {
      const notifyCmd = `docker exec postgres-db psql -U development -d regenesis -c "NOTIFY metadata_changed, 'dashboard_manual_trigger';" 2>&1`;
      conn.exec(notifyCmd, (err, channel) => {
        if (err) {
          clearTimeout(timeout);
          try { conn.end(); } catch (_) {}
          if (!isHandled) {
            isHandled = true;
            return reject(err);
          }
          return;
        }

        let out = '';
        channel.on('data', d => out += d);
        if (channel.stderr) channel.stderr.on('data', d => out += d);

        channel.on('close', (code) => {
          clearTimeout(timeout);
          try { conn.end(); } catch (_) {}
          if (!isHandled) {
            isHandled = true;
            resolve({
              success: true,
              output: out.trim(),
              targetHost: `${sshConfig.username}@${sshConfig.host}:${sshConfig.port}`,
              message: 'Sinyal NOTIFY metadata_changed berhasil dikirimkan ke PostgreSQL di POD.'
            });
          }
        });
      });
    });

    conn.on('error', (connErr) => {
      clearTimeout(timeout);
      if (!isHandled) {
        isHandled = true;
        try { conn.end(); } catch (_) {}
        reject(new Error(`Koneksi SSH error (${sshConfig.host}): ${connErr.message}`));
      }
    });

    try {
      conn.connect(sshConfig);
    } catch (e) {
      clearTimeout(timeout);
      if (!isHandled) {
        isHandled = true;
        reject(e);
      }
    }
  });
}

/**
 * Query PostgreSQL on remote POD and generate /home/pod/sounds/metadata.json
 * directly according to the exact logic in generte_mettda.ts
 *
 * @param {Object} serverConfig - Server credentials
 * @param {Object} [options={}] - Options (writeToFile, createBackup, notifyChannel)
 * @returns {Promise<Object>}
 */
function generateMetadataFromDatabase(serverConfig, options = {}) {
  const { writeToFile = true, createBackup = true, notifyChannel = true } = options;

  return new Promise((resolve, reject) => {
    let sshConfig;
    try {
      sshConfig = resolveSshConfig(serverConfig);
    } catch (err) {
      return reject(new Error(`Konfigurasi SSH tidak valid: ${err.message}`));
    }

    const conn = new Client();
    let isHandled = false;

    const timeout = setTimeout(() => {
      if (!isHandled) {
        isHandled = true;
        try { conn.end(); } catch (_) {}
        reject(new Error(`Timeout saat men-generate metadata dari database di ${sshConfig.host}`));
      }
    }, (sshConfig.readyTimeout || 15000) + 20000);

    conn.on('ready', async () => {
      // Helper function to execute SQL via docker exec psql on the pod
      function execSql(sql) {
        return new Promise((res, rej) => {
          const oneLineSql = sql.replace(/\s+/g, ' ').trim();
          conn.exec(`docker exec postgres-db psql -U development -d regenesis -t -A -c "${oneLineSql}"`, (err, stream) => {
            if (err) return rej(err);
            let out = '';
            let errOut = '';
            stream.on('data', d => out += d);
            if (stream.stderr) stream.stderr.on('data', d => errOut += d);
            stream.on('close', code => {
              if (code !== 0) {
                return rej(new Error(`SQL error (code ${code}): ${errOut || out}`));
              }
              try {
                const parsed = JSON.parse(out.trim());
                res(parsed);
              } catch (parseErr) {
                rej(new Error(`Gagal mem-parse JSON hasil database: ${parseErr.message}. Output: ${out.slice(0, 200)}`));
              }
            });
          });
        });
      }

      try {
        // 1. Experiences with detail_experience and burst_time
        const sqlExperiences = `
          SELECT coalesce(json_agg(json_build_object(
            'menu_name', e.menu_name,
            'information', e.information,
            'detail_experience', (
              SELECT coalesce(json_agg(json_build_object(
                'sound_scape', d.sound_scape,
                'caption', d.caption,
                'duration', d.duration,
                'song', d.song,
                'lamp', d.lamp,
                'scent', d.scent,
                'burst_time', (
                  SELECT coalesce(json_agg(json_build_object('start_time', b.start_time, 'duration', b.duration)), '[]'::json)
                  FROM burst_time b WHERE b.fk_detail_experience = d.id AND b.deleted_at IS NULL
                )
              )), '[]'::json)
              FROM detail_experience d WHERE d.experience_id = e.id AND d.deleted_at IS NULL
            )
          )), '[]'::json)
          FROM experiences e WHERE e.deleted_at IS NULL;
        `;

        // 2. Sound Tasks (Guides)
        const sqlSoundTasks = `
          SELECT coalesce(json_agg(json_build_object(
            'sound_task_code', sound_task_code,
            'sound_little', sound_little,
            'sound_less', sound_less,
            'sound_advance', sound_advance,
            'duration_little', duration_little,
            'duration_less', duration_less,
            'duration_advance', duration_advance
          )), '[]'::json)
          FROM sound_task WHERE deleted_at IS NULL;
        `;

        // 3. Self Development Sounds
        const sqlSelfDev = `
          SELECT coalesce(json_agg(json_build_object(
            'sound_code', s.sound_code,
            'description', s.description,
            'title', s.title,
            'duration', s.duration,
            'filepath', s.filepath,
            'video', s.video,
            'lamp', s.lamp,
            'self_development', (
              SELECT json_build_object(
                'self_development_name', sd.self_development_name,
                'description', sd.description
              )
              FROM self_development sd WHERE sd.id = s.self_development_id
            )
          )), '[]'::json)
          FROM self_development_sound s WHERE s.deleted_at IS NULL;
        `;

        const [experiences, soundTasks, sounds] = await Promise.all([
          execSql(sqlExperiences),
          execSql(sqlSoundTasks),
          execSql(sqlSelfDev)
        ]);

        // Transform Domain 1: Sessions
        const formattedResult = (experiences || []).flatMap((exp) =>
          (exp.detail_experience || []).map((detail) => ({
            type: 'Sessions',
            id: detail.sound_scape,
            caption: detail.caption,
            session: exp.menu_name,
            duration: Math.ceil(Number(detail.duration) * 60000),
            filepath: detail.song ? `${detail.song}` : null,
            strobepath: detail.lamp ? `${detail.lamp}` : null,
            display: exp.menu_name,
            details: {
              title: exp.menu_name,
              description: exp.information ?? exp.menu_name,
            },
            scent: detail.scent ? detail.scent.toString() : null,
            burstTime: (detail.burst_time || []).reduce((acc, bt) => {
              acc[bt.start_time] = parseInt(bt.duration, 10);
              return acc;
            }, {})
          }))
        );

        // Transform Domain 2: Guides
        const transformedData = (soundTasks || []).flatMap((task) => {
          const taskName = task.sound_task_code;
          return [
            {
              type: 'Guides',
              id: `${taskName}mini`,
              session: 'Any',
              duration: task.duration_little || 0,
              filepath: task.sound_little ? `${task.sound_little}` : null,
              display: `${taskName}lite`,
            },
            {
              type: 'Guides',
              id: `${taskName}less`,
              session: 'Any',
              duration: task.duration_less || 0,
              filepath: task.sound_less ? `${task.sound_less}` : null,
              display: `${taskName}less`,
            },
            {
              type: 'Guides',
              id: `${taskName}full`,
              session: 'Any',
              duration: task.duration_advance || 0,
              filepath: task.sound_advance ? `${task.sound_advance}` : null,
              display: `${taskName}advance`,
            },
          ].filter((item) => item.filepath !== null);
        });

        // Transform Domain 3: SelfDevelopment
        const formattedSounds = (sounds || []).map((sound) => {
          const durationMs = parseInt(sound.duration || '0', 10) * 1000;
          return {
            type: 'SelfDevelopment',
            id: sound.sound_code,
            description: sound.description,
            session: sound.self_development?.self_development_name || 'Unknown',
            duration: durationMs,
            display: sound.self_development?.self_development_name || 'Unknown',
            filepath: sound.filepath || 'Unknown',
            details: {
              title: sound.title || 'No Title',
              description: sound.description || 'No Description',
              soundPath: sound.filepath || 'Unknown',
            },
            video: sound.video,
            strobepath: sound.lamp ? `${sound.lamp}` : null,
          };
        });

        const finalMergedData = formattedResult.concat(transformedData).concat(formattedSounds);

        // Optional NOTIFY trigger in postgres
        if (notifyChannel) {
          try {
            await new Promise(r => conn.exec(`docker exec postgres-db psql -U development -d regenesis -c "NOTIFY metadata_changed, 'generate_metadata_completed';"`, () => r()));
          } catch (_) {}
        }

        clearTimeout(timeout);
        try { conn.end(); } catch (_) {}

        if (!isHandled) {
          isHandled = true;

          // If requested, write directly to /home/pod/sounds/metadata.json
          if (writeToFile) {
            await writeRemoteMetadata(serverConfig, finalMergedData, createBackup);
          }

          resolve({
            success: true,
            serverName: sshConfig.name,
            targetHost: `${sshConfig.username}@${sshConfig.host}:${sshConfig.port}`,
            totalItems: finalMergedData.length,
            stats: {
              sessionsCount: formattedResult.length,
              guidesCount: transformedData.length,
              selfDevelopmentCount: formattedSounds.length
            },
            writtenToFile: writeToFile,
            path: REMOTE_METADATA_FILE,
            metadata: finalMergedData
          });
        }
      } catch (procErr) {
        clearTimeout(timeout);
        try { conn.end(); } catch (_) {}
        if (!isHandled) {
          isHandled = true;
          reject(procErr);
        }
      }
    });

    conn.on('error', (connErr) => {
      clearTimeout(timeout);
      if (!isHandled) {
        isHandled = true;
        try { conn.end(); } catch (_) {}
        reject(new Error(`Koneksi SSH error (${sshConfig.host}): ${connErr.message}`));
      }
    });

    try {
      conn.connect(sshConfig);
    } catch (e) {
      clearTimeout(timeout);
      if (!isHandled) {
        isHandled = true;
        reject(e);
      }
    }
  });
}

module.exports = {
  readRemoteMetadata,
  writeRemoteMetadata,
  restoreRemoteMetadata,
  triggerRemoteDatabaseSync,
  generateMetadataFromDatabase,
  REMOTE_METADATA_FILE,
  REMOTE_METADATA_BACKUP
};

