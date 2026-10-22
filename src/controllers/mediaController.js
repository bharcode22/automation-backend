const { uploadFilesToRemoteServer, listMediaCategory, categorizeFile } = require('../services/sftpUploadService');
const { loadSshCredentials, loadSshCredentialsList } = require('../config/sshConfig');

/**
 * POST /api/ssh/media/upload
 * Handle single or batch media file upload with auto-routing
 */
async function handleUploadFiles(req, res) {
  try {
    const files = req.files || (req.file ? [req.file] : []);
    if (!files || files.length === 0) {
      return res.status(400).json({ success: false, error: 'Tidak ada berkas yang dipilih untuk diunggah.' });
    }

    const { targetServerId, broadcast = false } = req.body || {};
    const isBroadcast = broadcast === 'true' || broadcast === true;

    // Determine target servers
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

    const uploadResults = [];
    const errors = [];

    // Process each target server with a single persistent connection for all files
    for (const server of targetServers) {
      const serverLabel = server.name || `${server.username}@${server.host}:${server.port}`;
      try {
        const results = await uploadFilesToRemoteServer(server, files);
        for (const r of results) {
          if (r.success) {
            uploadResults.push({
              serverName: serverLabel,
              ...r
            });
          } else {
            errors.push({
              serverName: serverLabel,
              filename: r.filename,
              targetHost: r.targetHost,
              error: r.error
            });
          }
        }
      } catch (serverErr) {
        // Entire connection or SFTP session failed for this server
        for (const file of files) {
          errors.push({
            serverName: serverLabel,
            filename: file.originalname,
            targetHost: `${server.username}@${server.host}:${server.port}`,
            error: serverErr.message
          });
        }
      }
    }

    return res.json({
      success: uploadResults.length > 0,
      uploadedCount: uploadResults.length,
      failedCount: errors.length,
      results: uploadResults,
      errors: errors.length > 0 ? errors : undefined,
      message: errors.length === 0
        ? `Berhasil mengunggah ${uploadResults.length} berkas ke ${targetServers.length} POD.`
        : `Selesai dengan ${uploadResults.length} berhasil dan ${errors.length} gagal.`
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}

/**
 * GET /api/ssh/media/list?target=...&category=sounds|videos|images|all
 * List uploaded files in the media folders of a POD
 */
async function handleListMedia(req, res) {
  try {
    const { target, category = 'all' } = req.query;
    const server = loadSshCredentials(target);
    const result = await listMediaCategory(server, category);
    return res.json({ success: true, ...result });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}

/**
 * GET /api/ssh/media/detect?filename=example.mp3
 * Helper endpoint to preview where a file will be stored
 */
async function handleDetectCategory(req, res) {
  try {
    const filename = req.query.filename || '';
    const detection = categorizeFile(filename);
    return res.json({ success: true, filename, ...detection });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}

module.exports = {
  handleUploadFiles,
  handleListMedia,
  handleDetectCategory
};
