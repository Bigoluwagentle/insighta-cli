const fs   = require("fs");
const path = require("path");
const os   = require("os");

const CREDS_DIR  = path.join(os.homedir(), ".insighta");
const CREDS_FILE = path.join(CREDS_DIR, "credentials.json");

function loadCredentials() {
  try { return JSON.parse(fs.readFileSync(CREDS_FILE, "utf8")); }
  catch { return null; }
}

function saveCredentials(data) {
  fs.mkdirSync(CREDS_DIR, { recursive: true });
  fs.writeFileSync(CREDS_FILE, JSON.stringify(data, null, 2));
}

function clearCredentials() {
  try { fs.unlinkSync(CREDS_FILE); } catch {}
}

module.exports = { loadCredentials, saveCredentials, clearCredentials };