const {
  readRemoteMetadata,
  writeRemoteMetadata,
  restoreRemoteMetadata,
  triggerRemoteDatabaseSync,
  generateMetadataFromDatabase
} = require('../services/metadataService');
const { loadSshCredentials, loadSshCredentialsList } = require('../config/sshConfig');

/**
 * GET /api/ssh/metadata?target=...
 * Fetch /home/pod/sounds/metadata.json from target POD
 */
async function handleGetMetadata(req, res) {
  try {
    const { target } = req.query;
    const server = loadSshCredentials(target);
    if (!server) {
      return res.status(404).json({ success: false, error: 'Target server SSH tidak ditemukan.' });
    }

    const result = await readRemoteMetadata(server);
    return res.json({
      success: true,
      serverName: server.name || `${server.username}@${server.host}:${server.port}`,
      ...result
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}

/**
 * POST /api/ssh/metadata
 * Save /home/pod/sounds/metadata.json (support single server or broadcast to all)
 */
async function handleSaveMetadata(req, res) {
  try {
    const { targetServerId, content, broadcast = false, createBackup = true } = req.body || {};

    if (content === undefined || content === null) {
      return res.status(400).json({ success: false, error: 'Konten metadata tidak boleh kosong.' });
    }

    const isBroadcast = broadcast === true || broadcast === 'true';
    let targetServers = [];

    if (isBroadcast) {
      targetServers = loadSshCredentialsList();
    } else {
      const target = loadSshCredentials(targetServerId);
      targetServers = target ? [target] : [];
    }

    if (targetServers.length === 0) {
      return res.status(400).json({ success: false, error: 'Tidak ada server POD target yang tersedia.' });
    }

    const results = [];
    const errors = [];

    for (const server of targetServers) {
      const serverLabel = server.name || `${server.username}@${server.host}:${server.port}`;
      try {
        const r = await writeRemoteMetadata(server, content, createBackup);
        results.push({
          serverName: serverLabel,
          ...r
        });
      } catch (err) {
        errors.push({
          serverName: serverLabel,
          host: `${server.username}@${server.host}:${server.port}`,
          error: err.message
        });
      }
    }

    return res.json({
      success: results.length > 0,
      savedCount: results.length,
      failedCount: errors.length,
      results,
      errors: errors.length > 0 ? errors : undefined,
      message: errors.length === 0
        ? `Berhasil menyimpan metadata ke ${results.length} server POD.`
        : `Selesai dengan ${results.length} berhasil dan ${errors.length} gagal.`
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}

/**
 * POST /api/ssh/metadata/restore
 * Restore /home/pod/sounds/metadata.json from metadata.json.bak
 */
async function handleRestoreMetadata(req, res) {
  try {
    const { targetServerId } = req.body || {};
    const server = loadSshCredentials(targetServerId);
    if (!server) {
      return res.status(404).json({ success: false, error: 'Target server SSH tidak ditemukan.' });
    }

    const result = await restoreRemoteMetadata(server);
    return res.json({
      success: true,
      serverName: server.name || `${server.username}@${server.host}:${server.port}`,
      ...result
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}

/**
 * POST /api/ssh/metadata/generate-from-db
 * Directly query remote PostgreSQL on POD and regenerate /home/pod/sounds/metadata.json
 * according to generte_mettda.ts logic
 */
async function handleGenerateMetadataFromDb(req, res) {
  try {
    const { targetServerId, broadcast = false, createBackup = true } = req.body || {};
    const isBroadcast = broadcast === true || broadcast === 'true';

    let targetServers = [];
    if (isBroadcast) {
      targetServers = loadSshCredentialsList();
    } else {
      const target = loadSshCredentials(targetServerId);
      targetServers = target ? [target] : [];
    }

    if (targetServers.length === 0) {
      return res.status(400).json({ success: false, error: 'Tidak ada server POD target yang tersedia.' });
    }

    const results = [];
    const errors = [];

    for (const server of targetServers) {
      const serverLabel = server.name || `${server.username}@${server.host}:${server.port}`;
      try {
        const r = await generateMetadataFromDatabase(server, {
          writeToFile: true,
          createBackup,
          notifyChannel: true
        });
        results.push({
          serverName: serverLabel,
          ...r
        });
      } catch (err) {
        errors.push({
          serverName: serverLabel,
          host: `${server.username}@${server.host}:${server.port}`,
          error: err.message
        });
      }
    }

    const totalGenerated = results.reduce((acc, curr) => acc + (curr.totalItems || 0), 0);

    return res.json({
      success: results.length > 0,
      generatedServersCount: results.length,
      failedServersCount: errors.length,
      totalGeneratedItems: results[0]?.totalItems || totalGenerated,
      stats: results[0]?.stats || {},
      results,
      errors: errors.length > 0 ? errors : undefined,
      message: errors.length === 0
        ? `Berhasil men-generate metadata dari database untuk ${results.length} server POD (${results[0]?.totalItems || 0} item).`
        : `Generate selesai dengan ${results.length} berhasil dan ${errors.length} gagal.`
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}

/**
 * POST /api/ssh/metadata/sync-db
 * Execute direct database metadata generation and notify PostgreSQL on POD
 */
async function handleSyncDb(req, res) {
  try {
    const { targetServerId, broadcast = false } = req.body || {};
    const isBroadcast = broadcast === true || broadcast === 'true';

    // Prefer full generation from database
    return handleGenerateMetadataFromDb(req, res);
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}

module.exports = {
  handleGetMetadata,
  handleSaveMetadata,
  handleRestoreMetadata,
  handleSyncDb,
  handleGenerateMetadataFromDb
};

