const express = require('express');
const router = express.Router();
const multer = require('multer');

// Configure multer with memory storage (buffers kept in memory and streamed directly to SFTP)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 500 * 1024 * 1024 // 500MB max per file
  }
});

const {
  handleGetConfig,
  handleSaveConfig,
  handleDeleteConfig,
  handleTestConnection
} = require('../controllers/sshController');

const {
  handleUploadFiles,
  handleListMedia,
  handleDetectCategory
} = require('../controllers/mediaController');

const {
  handleGetMetadata,
  handleSaveMetadata,
  handleRestoreMetadata,
  handleSyncDb,
  handleGenerateMetadataFromDb
} = require('../controllers/metadataController');

// 1. Multi-SSH Configuration stored in credential-ssh.json
router.get('/config', handleGetConfig);
router.post('/config', handleSaveConfig);
router.delete('/config/:idOrHost', handleDeleteConfig);

// 2. SSH Connection Test Handshake
router.post('/test', handleTestConnection);

// 3. Smart Media Uploader via SFTP
router.post('/media/upload', upload.array('files', 50), handleUploadFiles);
router.get('/media/list', handleListMedia);
router.get('/media/detect', handleDetectCategory);

// 4. Remote /home/pod/sounds/metadata.json Management
router.get('/metadata', handleGetMetadata);
router.post('/metadata', handleSaveMetadata);
router.post('/metadata/restore', handleRestoreMetadata);
router.post('/metadata/sync-db', handleSyncDb);
router.post('/metadata/generate-from-db', handleGenerateMetadataFromDb);

module.exports = router;


