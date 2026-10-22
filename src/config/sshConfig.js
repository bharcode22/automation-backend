const fs = require('fs');
const path = require('path');
const os = require('os');

// Path to credential-ssh.json in the backend root directory
const CREDENTIALS_FILE_PATH = process.env.CREDENTIALS_FILE_PATH || path.resolve(process.cwd(), 'credential-ssh.json');

/**
 * Default fallback credentials
 */
const fallbackDefaults = {
  host: process.env.SSH_DEFAULT_HOST || '127.0.0.1',
  port: parseInt(process.env.SSH_DEFAULT_PORT, 10) || 22,
  username: process.env.SSH_DEFAULT_USERNAME || 'pod',
  authType: process.env.SSH_DEFAULT_AUTH_TYPE || 'password',
  password: process.env.SSH_DEFAULT_PASSWORD || '',
  keyPath: process.env.SSH_DEFAULT_KEY_PATH || '',
  passphrase: process.env.SSH_DEFAULT_PASSPHRASE || '',
  readyTimeout: parseInt(process.env.SSH_HANDSHAKE_TIMEOUT, 10) || 15000,
  commandTimeout: parseInt(process.env.SSH_COMMAND_TIMEOUT, 10) || 30000
};

/**
 * Helper to resolve tilde (~) in file paths
 */
function resolvePath(filePath) {
  if (!filePath) return '';
  if (filePath.startsWith('~/') || filePath === '~') {
    return path.join(os.homedir(), filePath.slice(1));
  }
  return path.resolve(filePath);
}

/**
 * Normalize a single credential object with clean defaults and consistent keys
 * Prioritizes 'name' as a first-class identifier
 */
function normalizeCredential(item = {}, index = 0) {
  const host = item.host ? String(item.host).trim() : '127.0.0.1';
  const port = parseInt(item.port, 10) || 22;
  const username = item.username ? String(item.username).trim() : 'pod';
  const name = item.name ? String(item.name).trim() : (item.id ? String(item.id).trim() : `${username}@${host}`);
  const id = item.id ? String(item.id).trim() : name;

  return {
    name,
    id,
    host,
    port,
    username,
    authType: item.authType === 'key' ? 'key' : 'password',
    password: item.password !== undefined ? String(item.password) : '',
    keyPath: item.keyPath !== undefined ? String(item.keyPath).trim() : '',
    passphrase: item.passphrase !== undefined ? String(item.passphrase) : '',
    readyTimeout: parseInt(item.readyTimeout, 10) || 15000,
    commandTimeout: parseInt(item.commandTimeout, 10) || 30000
  };
}

/**
 * Load ALL SSH credentials as an Array from credential-ssh.json
 * Automatically handles whether the file is an Array or a single Object.
 *
 * @returns {Array<Object>} List of server credentials
 */
function loadSshCredentialsList() {
  try {
    if (fs.existsSync(CREDENTIALS_FILE_PATH)) {
      const content = fs.readFileSync(CREDENTIALS_FILE_PATH, 'utf8');
      const parsed = JSON.parse(content);

      if (Array.isArray(parsed)) {
        if (parsed.length === 0) {
          const defaultList = [normalizeCredential(fallbackDefaults, 0)];
          saveSshCredentialsList(defaultList);
          return defaultList;
        }
        return parsed.map((item, idx) => normalizeCredential(item, idx));
      } else if (parsed && typeof parsed === 'object') {
        return [normalizeCredential(parsed, 0)];
      }
    }

    // File not found or empty -> initialize with default
    const initialList = [normalizeCredential(fallbackDefaults, 0)];
    saveSshCredentialsList(initialList);
    return initialList;
  } catch (err) {
    console.error('⚠️ Gagal membaca credential-ssh.json, fallback ke default:', err.message);
    return [normalizeCredential(fallbackDefaults, 0)];
  }
}

/**
 * Load a single active SSH credential.
 * Supports matching by: name, id, host, username@host, or username@host:port
 */
function loadSshCredentials(targetIdentifier = null) {
  const list = loadSshCredentialsList();
  if (!targetIdentifier) {
    return list[0] || normalizeCredential(fallbackDefaults, 0);
  }

  const clean = String(targetIdentifier).trim().toLowerCase();
  const found = list.find((s) => {
    const sName = (s.name || '').toLowerCase();
    const sId = (s.id || '').toLowerCase();
    const sHost = (s.host || '').toLowerCase();
    const sFull = `${s.username}@${s.host}:${s.port}`.toLowerCase();
    const sShort = `${s.username}@${s.host}`.toLowerCase();

    return sName === clean || sId === clean || sHost === clean || sFull === clean || sShort === clean;
  });

  return found || list[0] || normalizeCredential(fallbackDefaults, 0);
}

/**
 * Save an entire list of SSH credentials to credential-ssh.json
 * Preserves 'name' at the very top of each JSON item
 */
function saveSshCredentialsList(newList = []) {
  if (!Array.isArray(newList)) {
    throw new Error('saveSshCredentialsList requires an array of credentials');
  }

  const normalized = newList.map((item, idx) => normalizeCredential(item, idx));
  
  // Clean JSON output structure with 'name' first
  const cleanJson = normalized.map((s) => {
    const out = {
      name: s.name,
      host: s.host,
      port: s.port,
      username: s.username,
      authType: s.authType,
      password: s.password,
      keyPath: s.keyPath,
      passphrase: s.passphrase,
      readyTimeout: s.readyTimeout,
      commandTimeout: s.commandTimeout
    };
    if (s.id && s.id !== s.name && s.id !== `${s.username}@${s.host}:${s.port}`) {
      out.id = s.id;
    }
    return out;
  });

  fs.writeFileSync(CREDENTIALS_FILE_PATH, JSON.stringify(cleanJson, null, 2), 'utf8');
  return normalized;
}

/**
 * Save / Update a credential.
 * Supports:
 * - If Array passed: saves the whole list
 * - If Single Object passed: updates existing match by name, id or host, or appends as new server
 */
function saveSshCredentials(newConfig = {}) {
  if (Array.isArray(newConfig)) {
    return saveSshCredentialsList(newConfig);
  }

  const currentList = loadSshCredentialsList();
  const normalizedNew = normalizeCredential(newConfig);

  const existingIndex = currentList.findIndex(
    (s) =>
      (s.name && s.name.toLowerCase() === normalizedNew.name.toLowerCase()) ||
      (s.id && s.id === normalizedNew.id) ||
      (s.host === normalizedNew.host && s.port === normalizedNew.port && s.username === normalizedNew.username)
  );

  let updatedList;
  if (existingIndex >= 0) {
    // Update existing server
    updatedList = [...currentList];
    updatedList[existingIndex] = { ...updatedList[existingIndex], ...normalizedNew };
  } else {
    // Append as new server
    updatedList = [...currentList, normalizedNew];
  }

  saveSshCredentialsList(updatedList);
  return updatedList;
}

/**
 * Delete a credential from credential-ssh.json by name, id or host
 */
function deleteSshCredential(idOrHostOrName) {
  const currentList = loadSshCredentialsList();
  const clean = String(idOrHostOrName).trim().toLowerCase();
  const filtered = currentList.filter((s) => {
    const sName = (s.name || '').toLowerCase();
    const sId = (s.id || '').toLowerCase();
    const sHost = (s.host || '').toLowerCase();
    const sFull = `${s.username}@${s.host}:${s.port}`.toLowerCase();
    return sName !== clean && sId !== clean && sHost !== clean && sFull !== clean;
  });

  if (filtered.length === 0) {
    // Keep at least one fallback default
    filtered.push(normalizeCredential(fallbackDefaults, 0));
  }

  saveSshCredentialsList(filtered);
  return filtered;
}

/**
 * Resolve SSH configuration by combining saved credentials with request-specific overrides
 */
function resolveSshConfig(overrides = {}) {
  // If target specified by name, id or host, load that specific server
  const targetIdentifier = overrides.name || overrides.id || overrides.host || overrides.target;
  const saved = loadSshCredentials(targetIdentifier);

  const merged = {
    name: overrides.name || saved.name,
    host: (overrides.host ? String(overrides.host).trim() : saved.host),
    port: parseInt(overrides.port, 10) || saved.port,
    username: (overrides.username ? String(overrides.username).trim() : saved.username),
    readyTimeout: parseInt(overrides.readyTimeout, 10) || saved.readyTimeout || 15000,
    commandTimeout: parseInt(overrides.commandTimeout, 10) || saved.commandTimeout || 30000
  };

  const authType = overrides.authType || (overrides.privateKey || overrides.keyPath ? 'key' : saved.authType);

  if (authType === 'key') {
    let privateKeyContent = overrides.privateKey;

    if (!privateKeyContent) {
      const keyPath = resolvePath(overrides.keyPath || saved.keyPath);
      if (keyPath && fs.existsSync(keyPath)) {
        try {
          privateKeyContent = fs.readFileSync(keyPath, 'utf8');
        } catch (err) {
          throw new Error(`Gagal membaca file private key di ${keyPath}: ${err.message}`);
        }
      }
    }

    if (!privateKeyContent) {
      if (overrides.password || saved.password) {
        merged.password = overrides.password || saved.password;
      } else {
        throw new Error('Otentikasi SSH Key dipilih namun isi private key atau file key tidak ditemukan.');
      }
    } else {
      merged.privateKey = privateKeyContent;
      const passphrase = overrides.passphrase !== undefined ? overrides.passphrase : saved.passphrase;
      if (passphrase) {
        merged.passphrase = passphrase;
      }
    }
  } else {
    merged.password = overrides.password !== undefined ? overrides.password : saved.password;
  }

  return merged;
}

module.exports = {
  CREDENTIALS_FILE_PATH,
  normalizeCredential,
  loadSshCredentialsList,
  loadSshCredentials,
  saveSshCredentialsList,
  saveSshCredentials,
  deleteSshCredential,
  resolveSshConfig,
  resolvePath
};
