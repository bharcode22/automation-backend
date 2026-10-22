require('dotenv').config();
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
      metadataRestore: 'POST /api/ssh/metadata/restore'
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

