const express = require('express');
const router = express.Router();
const multer = require('multer');
const os = require('os');
const path = require('path');

// Configure multer with disk storage (streams directly to temporary disk to support unlimited file size without RAM exhaustion)
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, os.tmpdir());
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `upload-${uniqueSuffix}-${path.basename(file.originalname)}`);
  }
});

const upload = multer({
  storage,
  limits: {
    // No fileSize limit (unlimited file size)
    files: 50 // Up to 50 files per batch
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
  handleGenerateMetadataFromDb,
  handleMutateAndGenerateMetadata,
  handleTestDatabaseConnection,
  handleGetDatabaseMetadata,
  handleGetExperiences,
  handleGetSelfDevelopment,
  handleGetGuides
} = require('../controllers/metadataController');

const {
  handleRunScript,
  handleListScripts
} = require('../controllers/scriptController');

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

// 4. Remote /home/pod/sounds/metadata.json & Database Management
router.get('/metadata', handleGetMetadata);
router.post('/metadata', handleSaveMetadata);
router.post('/metadata/restore', handleRestoreMetadata);
router.post('/metadata/sync-db', handleSyncDb);
router.post('/metadata/generate-from-db', handleGenerateMetadataFromDb);
router.post('/metadata/mutate-and-generate', handleMutateAndGenerateMetadata);
router.post('/database/mutate-and-generate', handleMutateAndGenerateMetadata);
router.get('/database/test', handleTestDatabaseConnection);
router.post('/database/test', handleTestDatabaseConnection);
router.get('/database/metadata', handleGetDatabaseMetadata);
router.get('/database/data', handleGetDatabaseMetadata);
router.get('/database/experiences', handleGetExperiences);
router.get('/database/experience', handleGetExperiences);
router.get('/database/self-development', handleGetSelfDevelopment);
router.get('/database/self_development', handleGetSelfDevelopment);
router.get('/database/guides', handleGetGuides);

// 5. Remote Shell Scripts Execution (/home/pod/scripts/exec)
router.post('/scripts/run', handleRunScript);
router.get('/scripts/list', handleListScripts);

module.exports = router;
