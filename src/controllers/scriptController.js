const {
  ALLOWED_SCRIPTS,
  REMOTE_SCRIPT_DIR,
  executePodScript,
  listPodScripts
} = require('../services/scriptService');
const { loadSshCredentials, loadSshCredentialsList } = require('../config/sshConfig');

/**
 * POST /api/ssh/scripts/run
 * Execute a whitelisted script in /home/pod/scripts/exec
 * Payload:
 * {
 *   "targetServerId": "pod 30",       // server name, id, or host
 *   "scriptName": "kill-process.sh", // or "auto-script.sh"
 *   "broadcast": false,              // true to run on all POD servers
 *   "timeoutMs": 45000               // optional timeout
 * }
 */
async function handleRunScript(req, res) {
  try {
    const { targetServerId, scriptName, broadcast = false, timeoutMs } = req.body || {};

    if (!scriptName) {
      return res.status(400).json({
        success: false,
        error: `Parameter 'scriptName' wajib disertakan. Pilihan: ${ALLOWED_SCRIPTS.join(', ')}`
      });
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
      return res.status(400).json({
        success: false,
        error: 'Tidak ada server POD target yang tersedia.'
      });
    }

    const results = [];
    const errors = [];

    for (const server of targetServers) {
      const serverLabel = server.name || `${server.username}@${server.host}:${server.port}`;
      try {
        const result = await executePodScript(server, scriptName, { timeoutMs });
        results.push({
          serverName: serverLabel,
          ...result
        });
      } catch (err) {
        errors.push({
          serverName: serverLabel,
          host: `${server.username}@${server.host}:${server.port}`,
          error: err.message
        });
      }
    }

    const allSuccessful = errors.length === 0 && results.every((r) => r.success);

    return res.json({
      success: allSuccessful,
      scriptName,
      directory: REMOTE_SCRIPT_DIR,
      ranCount: results.length,
      failedCount: errors.length,
      results,
      errors: errors.length > 0 ? errors : undefined,
      message: allSuccessful
        ? `Berhasil menjalankan ./${scriptName} pada ${results.length} server POD.`
        : `Eksekusi script selesai dengan ${results.length} berhasil dan ${errors.length} gagal.`
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: err.message
    });
  }
}

/**
 * GET /api/ssh/scripts/list?target=...
 * List available shell scripts in /home/pod/scripts/exec on the target POD
 */
async function handleListScripts(req, res) {
  try {
    const { target } = req.query;
    const server = loadSshCredentials(target);
    if (!server) {
      return res.status(404).json({
        success: false,
        error: 'Target server SSH tidak ditemukan.'
      });
    }

    const result = await listPodScripts(server);
    return res.json({
      success: result.success,
      serverName: server.name || `${server.username}@${server.host}:${server.port}`,
      ...result
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: err.message
    });
  }
}

module.exports = {
  handleRunScript,
  handleListScripts
};
