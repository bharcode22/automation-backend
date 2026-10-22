const { Client } = require('ssh2');
const { resolveSshConfig } = require('../config/sshConfig');

// Store active terminal sessions: Map<socketId, { conn, stream, type }>
const activeSessions = new Map();

/**
 * Register all Socket.IO real-time SSH Terminal handlers
 *
 * @param {import('socket.io').Server} io
 */
function registerSocketHandlers(io) {
  io.on('connection', (socket) => {
    console.log(`🔌 [Socket.io] Client connected: ${socket.id}`);

    // ----------------------------------------------------
    // 1. Interactive PTY Web Terminal
    // ----------------------------------------------------
    socket.on('terminal:start', (payload) => {
      stopSession(socket.id);

      const { cols = 80, rows = 24, config: customConfig = {} } = payload || {};
      let sshConfig;

      try {
        // Resolves configuration automatically from credential-ssh.json (with optional payload overrides)
        sshConfig = resolveSshConfig(customConfig);
      } catch (err) {
        return socket.emit('terminal:error', { error: `Konfigurasi SSH tidak valid: ${err.message}` });
      }

      const conn = new Client();
      let isHandled = false;

      const timeout = setTimeout(() => {
        if (!isHandled) {
          isHandled = true;
          try { conn.end(); } catch (_) {}
          socket.emit('terminal:error', { error: `Koneksi SSH ke ${sshConfig.host}:${sshConfig.port} timeout (15s)` });
        }
      }, sshConfig.readyTimeout || 15000);

      conn.on('ready', () => {
        clearTimeout(timeout);
        isHandled = true;

        conn.shell(
          {
            term: 'xterm-256color',
            cols: parseInt(cols, 10) || 80,
            rows: parseInt(rows, 10) || 24
          },
          (err, stream) => {
            if (err) {
              try { conn.end(); } catch (_) {}
              return socket.emit('terminal:error', { error: `Gagal membuka shell PTY: ${err.message}` });
            }

            activeSessions.set(socket.id, { conn, stream, type: 'terminal' });

            socket.emit('terminal:ready', {
              name: sshConfig.name,
              host: sshConfig.host,
              port: sshConfig.port,
              username: sshConfig.username
            });

            stream.on('data', (data) => {
              socket.emit('terminal:data', data.toString('utf-8'));
            });

            stream.stderr.on('data', (data) => {
              socket.emit('terminal:data', data.toString('utf-8'));
            });

            stream.on('close', () => {
              socket.emit('terminal:closed');
              stopSession(socket.id);
            });
          }
        );
      });

      conn.on('error', (err) => {
        clearTimeout(timeout);
        if (!isHandled) {
          isHandled = true;
          socket.emit('terminal:error', { error: `SSH Error (${sshConfig.host}): ${err.message}` });
          stopSession(socket.id);
        }
      });

      conn.on('close', () => {
        clearTimeout(timeout);
        socket.emit('terminal:closed');
        stopSession(socket.id);
      });

      try {
        conn.connect(sshConfig);
      } catch (connErr) {
        clearTimeout(timeout);
        socket.emit('terminal:error', { error: `Gagal koneksi SSH: ${connErr.message}` });
        stopSession(socket.id);
      }
    });

    // Keystroke / input forwarding to remote PTY
    socket.on('terminal:input', (data) => {
      const session = activeSessions.get(socket.id);
      if (session && session.stream && typeof data === 'string') {
        try {
          session.stream.write(data);
        } catch (e) {
          console.error('Error writing to remote PTY stream:', e.message);
        }
      }
    });

    // Terminal resize (dynamic cols/rows from browser viewport)
    socket.on('terminal:resize', ({ cols, rows }) => {
      const session = activeSessions.get(socket.id);
      if (session && session.stream && typeof session.stream.setWindow === 'function') {
        try {
          session.stream.setWindow(parseInt(rows, 10), parseInt(cols, 10), 0, 0);
        } catch (_) {}
      }
    });

    // Explicit close terminal
    socket.on('terminal:close', () => {
      stopSession(socket.id);
    });

    // ----------------------------------------------------
    // Disconnect Cleanup
    // ----------------------------------------------------
    socket.on('disconnect', () => {
      console.log(`🔌 [Socket.io] Client disconnected: ${socket.id}`);
      stopSession(socket.id);
    });
  });
}

/**
 * Terminate active SSH connection & stream for a given socket
 */
function stopSession(socketId) {
  if (activeSessions.has(socketId)) {
    const session = activeSessions.get(socketId);
    if (session.stream) {
      try { session.stream.destroy(); } catch (_) {}
    }
    if (session.conn) {
      try { session.conn.end(); } catch (_) {}
    }
    activeSessions.delete(socketId);
  }
}

module.exports = {
  registerSocketHandlers,
  stopSession
};
