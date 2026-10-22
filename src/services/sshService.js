const { Client } = require('ssh2');
const path = require('path');
const { resolveSshConfig } = require('../config/sshConfig');

/**
 * Test SSH connection handshake and basic server diagnostics
 *
 * @param {Object} [customConfig={}] - Connection details
 * @returns {Promise<Object>} Connection test result
 */
function testConnection(customConfig = {}) {
  return new Promise((resolve) => {
    let sshConfig;
    try {
      sshConfig = resolveSshConfig(customConfig);
    } catch (err) {
      return resolve({ success: false, error: err.message });
    }

    const conn = new Client();
    const startTime = Date.now();
    let isHandled = false;

    const timeout = setTimeout(() => {
      if (!isHandled) {
        isHandled = true;
        try { conn.end(); } catch (_) {}
        resolve({
          success: false,
          error: `Koneksi SSH ke ${sshConfig.host}:${sshConfig.port} waktu habis (timeout ${sshConfig.readyTimeout}ms)`
        });
      }
    }, sshConfig.readyTimeout);

    conn.on('ready', () => {
      // Run quick lightweight diagnostic
      conn.exec('uname -srm; uptime -p 2>/dev/null || uptime', (err, stream) => {
        if (err) {
          clearTimeout(timeout);
          try { conn.end(); } catch (_) {}
          return resolve({ success: true, latencyMs: Date.now() - startTime, info: 'Connected, but command exec failed' });
        }

        let output = '';
        stream.on('data', (d) => { output += d.toString(); });
        stream.on('close', () => {
          clearTimeout(timeout);
          try { conn.end(); } catch (_) {}
          if (!isHandled) {
            isHandled = true;
            resolve({
              success: true,
              host: sshConfig.host,
              port: sshConfig.port,
              username: sshConfig.username,
              latencyMs: Date.now() - startTime,
              systemInfo: output.trim(),
              message: `Berhasil terhubung ke SSH ${sshConfig.username}@${sshConfig.host}:${sshConfig.port}`
            });
          }
        });
      });
    });

    conn.on('error', (err) => {
      clearTimeout(timeout);
      if (!isHandled) {
        isHandled = true;
        try { conn.end(); } catch (_) {}
        resolve({
          success: false,
          host: sshConfig.host,
          port: sshConfig.port,
          error: `Gagal terhubung SSH: ${err.message}`
        });
      }
    });

    try {
      conn.connect(sshConfig);
    } catch (connErr) {
      clearTimeout(timeout);
      if (!isHandled) {
        isHandled = true;
        resolve({ success: false, error: `Kesalahan inisialisasi: ${connErr.message}` });
      }
    }
  });
}

/**
 * Execute a single shell command on remote server via SSH
 *
 * @param {string} command - Shell command
 * @param {Object} [customConfig={}] - Connection details
 * @param {Object} [options={}] - Options (timeoutMs, envPrefix, pty)
 * @returns {Promise<Object>} Output object with stdout, stderr, code, latency
 */
function executeCommand(command, customConfig = {}, options = {}) {
  return new Promise((resolve, reject) => {
    let sshConfig;
    try {
      sshConfig = resolveSshConfig(customConfig);
    } catch (err) {
      return reject(new Error(`Konfigurasi SSH tidak valid: ${err.message}`));
    }

    const timeoutMs = options.timeoutMs || sshConfig.commandTimeout || 30000;
    const fullCommand = options.envPrefix ? `${options.envPrefix} ${command}` : command;

    const conn = new Client();
    const startTime = Date.now();
    let isHandled = false;
    let activeStream = null;

    const timeoutTimer = setTimeout(() => {
      if (!isHandled) {
        isHandled = true;
        if (activeStream) {
          try { activeStream.destroy(); } catch (_) {}
        }
        try { conn.end(); } catch (_) {}
        reject(new Error(`Perintah SSH melampaui batas waktu (${Math.round(timeoutMs / 1000)} detik)`));
      }
    }, timeoutMs);

    function cleanup() {
      clearTimeout(timeoutTimer);
      if (activeStream) {
        try { activeStream.destroy(); } catch (_) {}
      }
      try { conn.end(); } catch (_) {}
    }

    conn.on('ready', () => {
      conn.exec(fullCommand, (err, stream) => {
        if (err) {
          if (!isHandled) {
            isHandled = true;
            cleanup();
            return reject(new Error(`Gagal exec command: ${err.message}`));
          }
          return;
        }

        activeStream = stream;
        let stdout = '';
        let stderr = '';

        stream.on('data', (d) => {
          const str = d.toString();
          stdout += str;
          if (options.onStdout) options.onStdout(str);
        });

        stream.stderr.on('data', (d) => {
          const str = d.toString();
          stderr += str;
          if (options.onStderr) options.onStderr(str);
        });

        stream.on('close', (code, signal) => {
          if (!isHandled) {
            isHandled = true;
            cleanup();
            resolve({
              success: code === 0,
              code,
              signal,
              command: fullCommand,
              stdout: stdout.trim(),
              stderr: stderr.trim(),
              durationMs: Date.now() - startTime
            });
          }
        });
      });
    });

    conn.on('error', (err) => {
      if (!isHandled) {
        isHandled = true;
        cleanup();
        reject(new Error(`Koneksi SSH error (${sshConfig.host}): ${err.message}`));
      }
    });

    try {
      conn.connect(sshConfig);
    } catch (connErr) {
      if (!isHandled) {
        isHandled = true;
        cleanup();
        reject(new Error(`Kesalahan inisialisasi koneksi SSH: ${connErr.message}`));
      }
    }
  });
}

/**
 * List files and directories in remote path via SFTP
 */
function listRemoteDirectory(remotePath = '/', customConfig = {}) {
  return new Promise((resolve, reject) => {
    let sshConfig;
    try {
      sshConfig = resolveSshConfig(customConfig);
    } catch (err) {
      return reject(err);
    }

    const conn = new Client();
    let isHandled = false;

    const timeout = setTimeout(() => {
      if (!isHandled) {
        isHandled = true;
        try { conn.end(); } catch (_) {}
        reject(new Error('Timeout membaca direktori SFTP'));
      }
    }, sshConfig.readyTimeout);

    conn.on('ready', () => {
      conn.sftp((err, sftp) => {
        if (err) {
          clearTimeout(timeout);
          try { conn.end(); } catch (_) {}
          return reject(new Error(`Gagal inisialisasi SFTP: ${err.message}`));
        }

        sftp.readdir(remotePath, (readErr, list) => {
          clearTimeout(timeout);
          try { conn.end(); } catch (_) {}
          if (readErr) {
            return reject(new Error(`Gagal membaca path ${remotePath}: ${readErr.message}`));
          }

          const items = (list || []).map((item) => ({
            name: item.filename,
            isDirectory: item.attrs && (item.attrs.mode & 0o40000) === 0o40000,
            size: item.attrs ? item.attrs.size : 0,
            modifyTime: item.attrs && item.attrs.mtime ? new Date(item.attrs.mtime * 1000) : null
          }));

          resolve({ path: remotePath, items });
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

    conn.connect(sshConfig);
  });
}

/**
 * Read remote text file content via SFTP
 */
function readRemoteFile(remoteFilePath, customConfig = {}) {
  return new Promise((resolve, reject) => {
    let sshConfig;
    try {
      sshConfig = resolveSshConfig(customConfig);
    } catch (err) {
      return reject(err);
    }

    const conn = new Client();
    let isHandled = false;

    const timeout = setTimeout(() => {
      if (!isHandled) {
        isHandled = true;
        try { conn.end(); } catch (_) {}
        reject(new Error('Timeout membaca file SFTP'));
      }
    }, sshConfig.readyTimeout);

    conn.on('ready', () => {
      conn.sftp((err, sftp) => {
        if (err) {
          clearTimeout(timeout);
          try { conn.end(); } catch (_) {}
          return reject(err);
        }

        const chunks = [];
        const readStream = sftp.createReadStream(remoteFilePath);

        readStream.on('data', (c) => chunks.push(c));
        readStream.on('end', () => {
          clearTimeout(timeout);
          try { conn.end(); } catch (_) {}
          const content = Buffer.concat(chunks).toString('utf8');
          resolve({ filePath: remoteFilePath, content, size: content.length });
        });
        readStream.on('error', (streamErr) => {
          clearTimeout(timeout);
          try { conn.end(); } catch (_) {}
          reject(new Error(`Gagal membaca file: ${streamErr.message}`));
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

    conn.connect(sshConfig);
  });
}

module.exports = {
  testConnection,
  executeCommand,
  listRemoteDirectory,
  readRemoteFile
};
