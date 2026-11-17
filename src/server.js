require('dotenv').config();
const fs = require('fs');
const path = require('path');
const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');

const sshRoutes = require('./routes/sshRoutes');
const { registerSocketHandlers } = require('./services/socketHandler');
const { loadSshCredentials, loadSshCredentialsList } = require('./config/sshConfig');

const app = express();
const server = http.createServer(app);

const PORT = parseInt(process.env.PORT, 10) || 5050;
const HOST = process.env.HOST || '0.0.0.0';
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';

// In-memory buffer for REST API activity logs (last 200 requests)
const requestLogs = [];
const MAX_LOGS = 200;
const logFilePath = path.join(__dirname, '../server.log');

function addLog(logEntry) {
  requestLogs.unshift(logEntry);
  if (requestLogs.length > MAX_LOGS) {
    requestLogs.pop();
  }
}

// Parse CORS origin config (support wildcard or comma-separated list)
const allowedOrigins = CORS_ORIGIN === '*' ? '*' : CORS_ORIGIN.split(',').map((s) => s.trim());

// Setup Socket.IO with CORS
const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    methods: ['GET', 'POST'],
    credentials: true
  }
});

// Middleware
app.use(cors({
  origin: allowedOrigins,
  credentials: true
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Helper to format & sanitize body for logging
function sanitizeAndFormatBody(body) {
  if (!body || typeof body !== 'object') return null;
  const clone = Array.isArray(body) ? [...body] : { ...body };
  if (clone.password) clone.password = '******';
  if (clone.passphrase) clone.passphrase = '******';
  if (Array.isArray(clone.content) && clone.content.length > 5) {
    clone.content = `[Array of ${clone.content.length} items...]`;
  }
  return clone;
}

// HTTP Request Logging Middleware (Console + File + In-Memory Buffer)
app.use((req, res, next) => {
  const start = Date.now();
  const timestamp = new Date().toISOString();
  const isMutationMethod = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method);
  const hasBody = req.body && Object.keys(req.body).length > 0;
  const sanitizedBody = hasBody ? sanitizeAndFormatBody(req.body) : null;

  // 1. Log immediately when the URL is hit
  let incomingLog = `\n📥 [${timestamp}] ${req.method} ${req.originalUrl || req.url}`;
  if (isMutationMethod && sanitizedBody) {
    let bodyPreview = JSON.stringify(sanitizedBody, null, 2);
    if (bodyPreview.length > 2000) {
      bodyPreview = bodyPreview.slice(0, 2000) + '\n   ... [truncated]';
    }
    incomingLog += `\n   📦 Body:\n${bodyPreview.split('\n').map((l) => '      ' + l).join('\n')}`;
  }
  console.log(incomingLog);

  try {
    fs.appendFileSync(logFilePath, `${incomingLog}\n`);
  } catch (_) { }

  // 2. Log when response finishes
  res.on('finish', () => {
    const duration = Date.now() - start;
    const statusCode = res.statusCode;
    const statusIcon = statusCode < 400 ? '✅' : '❌';
    const finishLine = `   ${statusIcon} Finished: ${statusCode} (${duration}ms)\n`;
    console.log(finishLine);

    const targetParam = req.query?.target || req.query?.targetServerId || req.body?.targetServerId || req.body?.target || '-';
    const logEntry = {
      timestamp,
      method: req.method,
      url: req.originalUrl || req.url,
      path: req.path,
      target: targetParam,
      statusCode,
      durationMs: duration,
      body: sanitizedBody || undefined,
      ip: req.ip || req.connection?.remoteAddress
    };

    addLog(logEntry);

    try {
      fs.appendFileSync(logFilePath, `${finishLine}\n`);
    } catch (_) { }
  });

  next();
});

// Root info endpoint
app.get('/', (req, res) => {
  const servers = loadSshCredentialsList();
  const currentCreds = servers[0] || {};
  res.json({
    service: 'ssh-backend-service',
    status: 'running',
    mode: 'headless-backend-ssh-focus',
    version: '1.2.0',
    credentialsSource: 'credential-ssh.json',
    serversCount: servers.length,
    servers: servers.map((s) => ({ id: s.id, name: s.name, target: `${s.username}@${s.host}:${s.port}` })),
    activeTarget: `${currentCreds.username}@${currentCreds.host}:${currentCreds.port}`,
    endpoints: {
      health: 'GET /health',
      configGet: 'GET /api/ssh/config',
      configSave: 'POST /api/ssh/config',
      configDelete: 'DELETE /api/ssh/config/:idOrHost',
      test: 'POST /api/ssh/test',
      mediaUpload: 'POST /api/ssh/media/upload',
      mediaList: 'GET /api/ssh/media/list',
      metadataGet: 'GET /api/ssh/metadata',
      metadataSave: 'POST /api/ssh/metadata',
      metadataRestore: 'POST /api/ssh/metadata/restore',
      scriptsRun: 'POST /api/ssh/scripts/run',
      scriptsList: 'GET /api/ssh/scripts/list'
    },
    websocket: {
      path: '/socket.io/',
      events: ['terminal:start', 'terminal:input', 'terminal:resize', 'terminal:close']
    }
  });
});

// Health check endpoint
app.get('/health', (req, res) => {
  const servers = loadSshCredentialsList();
  const currentCreds = servers[0] || {};
  res.json({
    status: 'ok',
    service: 'ssh-backend-service',
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.floor(process.uptime()),
    serversCount: servers.length,
    servers: servers.map((s) => `${s.username}@${s.host}:${s.port}`),
    targetDefault: `${currentCreds.username || 'pod'}@${currentCreds.host || '127.0.0.1'}:${currentCreds.port || 22}`,
    authType: currentCreds.authType || 'password'
  });
});

// REST API Request Activity Logs
app.get('/api/ssh/logs', (req, res) => {
  const limit = parseInt(req.query.limit, 10) || 50;
  res.json({
    success: true,
    count: Math.min(limit, requestLogs.length),
    totalLogs: requestLogs.length,
    logs: requestLogs.slice(0, limit)
  });
});

app.delete('/api/ssh/logs', (req, res) => {
  requestLogs.length = 0;
  res.json({ success: true, message: 'Log aktivitas REST API berhasil dibersihkan.' });
});

// Mount SSH API routes
app.use('/api/ssh', sshRoutes);

// Register Socket.io events (Interactive PTY Terminal)
registerSocketHandlers(io);

// 404 Handler
app.use((req, res) => {
  res.status(404).json({ success: false, error: `Route ${req.method} ${req.url} tidak ditemukan.` });
});

// Global Error Handler
app.use((err, req, res, next) => {
  console.error('❌ Server Error:', err);
  res.status(500).json({ success: false, error: err.message || 'Internal Server Error' });
});

// Catch unhandled errors gracefully
process.on('uncaughtException', (err) => {
  console.error('❌ Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
});

// Start Server
server.listen(PORT, HOST, () => {
  const servers = loadSshCredentialsList();
  console.log(`
  ==============================================================
  🚀 SSH Headless Backend Service is Running!
  --------------------------------------------------------------
  📡 REST API Base   : http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}
  🔌 WebSocket URL   : ws://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT} (path: /socket.io/)
  🩺 Health Endpoint : http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}/health
  🌐 CORS Origins    : ${Array.isArray(allowedOrigins) ? allowedOrigins.join(', ') : allowedOrigins}
  🔑 Credential File : credential-ssh.json (${servers.length} server terdaftar)
  🎯 Primary Host    : ${servers[0] ? `${servers[0].username}@${servers[0].host}:${servers[0].port}` : 'None'}
  ==============================================================
  `);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received. Closing HTTP server...');
  server.close(() => {
    console.log('HTTP server closed.');
    process.exit(0);
  });
});

