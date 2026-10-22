const { testConnection } = require('../services/sshService');
const {
  loadSshCredentialsList,
  loadSshCredentials,
  saveSshCredentialsList,
  saveSshCredentials,
  deleteSshCredential
} = require('../config/sshConfig');

/**
 * GET /api/ssh/config
 * Read all SSH credentials from credential-ssh.json
 */
async function handleGetConfig(req, res) {
  try {
    const servers = loadSshCredentialsList();
    const activeTarget = req.query.target ? loadSshCredentials(req.query.target) : (servers[0] || {});

    return res.json({
      success: true,
      count: servers.length,
      servers,
      activeTarget,
      // Backward-compatible field for components expecting single config
      config: activeTarget
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}

/**
 * POST /api/ssh/config
 * Save / update SSH credentials in credential-ssh.json
 * Supports updating full array or single server object.
 */
async function handleSaveConfig(req, res) {
  try {
    const body = req.body;
    let updatedServers;

    if (body && Array.isArray(body.servers)) {
      // Array inside { servers: [...] }
      updatedServers = saveSshCredentialsList(body.servers);
    } else if (Array.isArray(body)) {
      // Direct array [ {...}, {...} ]
      updatedServers = saveSshCredentialsList(body);
    } else if (body && typeof body === 'object') {
      // Single server object to add/update
      updatedServers = saveSshCredentials(body);
    } else {
      return res.status(400).json({ success: false, error: 'Payload tidak valid.' });
    }

    return res.json({
      success: true,
      message: 'Kredensial SSH berhasil disimpan ke credential-ssh.json',
      count: updatedServers.length,
      servers: updatedServers,
      config: updatedServers[0] || {}
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}

/**
 * DELETE /api/ssh/config/:idOrHost
 * Delete a specific server credential
 */
async function handleDeleteConfig(req, res) {
  try {
    const { idOrHost } = req.params;
    if (!idOrHost) {
      return res.status(400).json({ success: false, error: 'Parameter idOrHost wajib disertakan.' });
    }

    const updated = deleteSshCredential(decodeURIComponent(idOrHost));
    return res.json({
      success: true,
      message: `Server ${idOrHost} berhasil dihapus dari credential-ssh.json`,
      count: updated.length,
      servers: updated,
      config: updated[0] || {}
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}

/**
 * POST /api/ssh/test
 * Test SSH handshake to remote server
 */
async function handleTestConnection(req, res) {
  try {
    const customConfig = req.body || {};
    const result = await testConnection(customConfig);
    return res.status(result.success ? 200 : 400).json(result);
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}

module.exports = {
  handleGetConfig,
  handleSaveConfig,
  handleDeleteConfig,
  handleTestConnection
};

