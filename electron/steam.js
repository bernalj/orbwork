// Thin wrapper around steamworks.js. Every call is a no-op when Steam isn't available,
// so the game still runs when launched outside Steam (or before an App ID exists).
const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const { SPACEWAR_TEST_MAP } = require('./achievements');

const SPACEWAR = 480;
let steamworks = null;
let client = null;
let appId = null;

// App ID, first match wins: ORBWORK_STEAM_APPID env var, steam_appid.txt next to the exe (or project root in dev),
// SteamAppId (set by Steam when it launches the game), "steamAppId" in package.json, else Spacewar.
function resolveAppId() {
  if (process.env.ORBWORK_STEAM_APPID) return Number(process.env.ORBWORK_STEAM_APPID);
  const dirs = [path.dirname(process.execPath), app.getAppPath(), process.cwd()];
  for (const dir of dirs) {
    try {
      const id = Number(fs.readFileSync(path.join(dir, 'steam_appid.txt'), 'utf8').trim());
      if (id > 0) return id;
    } catch {}
  }
  if (Number(process.env.SteamAppId) > 0) return Number(process.env.SteamAppId);
  try { const id = Number(require('../package.json').steamAppId); if (id > 0) return id; } catch {}
  return SPACEWAR;
}

// Must run before app 'ready': the overlay needs command-line switches set up front.
function preReady() {
  if (process.env.ORBWORK_NO_STEAM) return;
  try {
    steamworks = require('steamworks.js');
    steamworks.electronEnableSteamOverlay();
  } catch (e) {
    console.warn('[steam] steamworks.js unavailable:', e.message);
    steamworks = null;
  }
}

// Shipping builds with a real App ID: if started outside Steam, ask Steam to launch it (returns true => quit now).
// Skipped for Spacewar, dev runs, and when steam_appid.txt is present (Valve's documented dev override).
function relaunchedThroughSteam() {
  if (!steamworks || !app.isPackaged || process.env.ORBWORK_NO_STEAM) return false;
  if (fs.existsSync(path.join(path.dirname(process.execPath), 'steam_appid.txt'))) return false;
  const id = resolveAppId();
  if (id === SPACEWAR) return false;
  try { return steamworks.restartAppIfNecessary(id); } catch { return false; }
}

function init() {
  if (!steamworks) return false;
  appId = resolveAppId();
  try {
    client = steamworks.init(appId);
    console.log(`[steam] connected as ${client.localplayer.getName()} (app ${appId})`);
    if (process.env.ORBWORK_STEAM_RESET_ACHIEVEMENTS) resetAchievements();
    return true;
  } catch (e) {
    console.warn(`[steam] not connected (app ${appId}): ${e.message}`);
    client = null;
    return false;
  }
}

const apiName = id => (appId === SPACEWAR ? SPACEWAR_TEST_MAP[id] : id);

function unlock(id) {
  const name = client && apiName(id);
  if (!name) return false;
  try {
    if (client.achievement.isActivated(name)) return false;
    const ok = client.achievement.activate(name);
    console.log(`[steam] achievement ${name}: ${ok ? 'unlocked' : 'failed'}`);
    return ok;
  } catch (e) {
    console.warn(`[steam] achievement ${name} error: ${e.message}`);
    return false;
  }
}

// Dev helper (ORBWORK_STEAM_RESET_ACHIEVEMENTS=1): re-lock everything this build can unlock.
function resetAchievements() {
  const { ACHIEVEMENTS } = require('./achievements');
  for (const a of ACHIEVEMENTS) {
    const name = apiName(a.id);
    if (name) try { client.achievement.clear(name); } catch {}
  }
  console.log('[steam] achievements reset');
}

module.exports = { preReady, relaunchedThroughSteam, init, unlock, connected: () => !!client, appId: () => appId };
