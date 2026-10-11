// Exposes window.orbworkHost to the game. index.html checks for it and falls back to web behavior when absent.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('orbworkHost', {
  loadSave: () => ipcRenderer.sendSync('save:load'),
  writeSave: json => ipcRenderer.sendSync('save:write', json),
  progress: summary => ipcRenderer.send('progress', summary),
  version: ipcRenderer.sendSync('app:version'),
  isFullscreen: () => ipcRenderer.sendSync('fullscreen:get'),
  setFullscreen: on => ipcRenderer.send('fullscreen:set', on),
  toggleFullscreen: () => ipcRenderer.send('fullscreen:toggle'),
  quit: () => ipcRenderer.send('app:quit'),
});
