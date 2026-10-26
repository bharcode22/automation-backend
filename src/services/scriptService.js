const { executeCommand } = require('./sshService');
const { resolveSshConfig } = require('../config/sshConfig');

const REMOTE_SCRIPT_DIR = '/home/pod/scripts/exec';
const ALLOWED_SCRIPTS = ['kill-process.sh', 'auto-script.sh'];

/**
 * Validate script name to prevent directory traversal or malicious command injection
 *
 * @param {string} scriptName
 * @returns {boolean}
 */
function isAllowedScript(scriptName) {
  if (!scriptName || typeof scriptName !== 'string') return false;
  const cleanName = scriptName.trim().replace(/^\.\//, ''); // Strip leading ./ if present
  return ALLOWED_SCRIPTS.includes(cleanName);
}

/**
 * Run a shell script located in /home/pod/scripts/exec on the remote POD
 *
 * @param {Object} serverConfig - Server credentials / target
 * @param {string} scriptName - e.g. 'kill-process.sh' or 'auto-script.sh'
 * @param {Object} [options={}] - Optional settings (timeoutMs, etc.)
 * @returns {Promise<Object>} Execution result with stdout, stderr, code, durationMs
 */
async function executePodScript(serverConfig, scriptName, options = {}) {
  const cleanName = (scriptName || '').trim().replace(/^\.\//, '');

  if (!isAllowedScript(cleanName)) {
    throw new Error(
      `Script '${scriptName}' tidak diizinkan. Script yang diizinkan hanya: ${ALLOWED_SCRIPTS.join(', ')}`
    );
  }

  // Sanitize filename strictly (alphanumeric, dash, underscore, dot)
  if (!/^[a-zA-Z0-9_\-\.]+$/.test(cleanName)) {
    throw new Error('Nama file script mengandung karakter ilegal.');
  }

  const timeoutMs = options.timeoutMs || 90000;

  // We execute using nohup backgrounding + PID tracking + log retrieval:
  // 1. nohup + redirection ensures child GUI apps (big-screen & small-screen) stay open permanently and are NOT killed when SSH disconnects.
  // 2. Child processes do not hold SSH stdout/stderr pipes, preventing the 45-second timeout.
  // 3. The loop waits until the bootstrap script finishes (screen positioning, docker start, etc.), then cat returns the complete log!
  const cmd = [
    `cd ${REMOTE_SCRIPT_DIR}`,
    `if [ ! -f ./${cleanName} ]; then echo "FILE_NOT_FOUND: Script ./${cleanName} tidak ditemukan di ${REMOTE_SCRIPT_DIR}" >&2; exit 127; fi`,
    `(sed -i 's/\\r$//' ./${cleanName} 2>/dev/null || true)`,
    `(chmod +x ./${cleanName} 2>/dev/null || true)`,
    `(nohup bash ./${cleanName} >/tmp/${cleanName}.log 2>&1 & pid=$!; while kill -0 $pid 2>/dev/null; do sleep 0.5; done; cat /tmp/${cleanName}.log)`
  ].join(' && ');

  const result = await executeCommand(cmd, serverConfig, {
    timeoutMs,
    envPrefix: ''
  });

  return {
    success: result.code === 0,
    scriptName: cleanName,
    scriptPath: `${REMOTE_SCRIPT_DIR}/${cleanName}`,
    targetServer: serverConfig.name || `${serverConfig.username}@${serverConfig.host}:${serverConfig.port}`,
    host: serverConfig.host,
    code: result.code,
    signal: result.signal,
    stdout: result.stdout,
    stderr: result.stderr,
    durationMs: result.durationMs
  };
}

/**
 * List scripts available in /home/pod/scripts/exec on the target POD
 *
 * @param {Object} serverConfig
 * @returns {Promise<Object>}
 */
async function listPodScripts(serverConfig) {
  const cmd = `mkdir -p ${REMOTE_SCRIPT_DIR} && ls -la ${REMOTE_SCRIPT_DIR} 2>/dev/null || true`;

  try {
    const result = await executeCommand(cmd, serverConfig, { timeoutMs: 15000 });
    const lines = (result.stdout || '').split('\n').map((l) => l.trim()).filter(Boolean);

    // Parse files from ls output
    const files = [];
    for (const line of lines) {
      const parts = line.split(/\s+/);
      const filename = parts[parts.length - 1];
      if (filename && filename.endsWith('.sh')) {
        files.push({
          filename,
          isWhitelisted: ALLOWED_SCRIPTS.includes(filename),
          details: line
        });
      }
    }

    return {
      success: true,
      directory: REMOTE_SCRIPT_DIR,
      allowedScripts: ALLOWED_SCRIPTS,
      foundScripts: files,
      rawOutput: result.stdout
    };
  } catch (err) {
    return {
      success: false,
      directory: REMOTE_SCRIPT_DIR,
      allowedScripts: ALLOWED_SCRIPTS,
      foundScripts: [],
      error: err.message
    };
  }
}

module.exports = {
  REMOTE_SCRIPT_DIR,
  ALLOWED_SCRIPTS,
  isAllowedScript,
  executePodScript,
  listPodScripts
};
