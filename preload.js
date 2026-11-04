const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('bubble', {
  onInit: (cb) => ipcRenderer.on('init', (_e, s) => cb(s)),
  onState: (cb) => ipcRenderer.on('state', (_e, s) => cb(s)),
  save: (patch) => ipcRenderer.send('save-settings', patch),
  collapseNow: () => ipcRenderer.send('collapse-now'),
  setPinned: (v) => ipcRenderer.send('set-pinned', v),
  quit: () => ipcRenderer.send('quit'),
  resizeStart: (side) => ipcRenderer.send('resize-start', side),
  resizeMove: () => ipcRenderer.send('resize-move'),
  resizeEnd: () => ipcRenderer.send('resize-end'),
  resetSize: () => ipcRenderer.send('reset-size'),
  setSize: (w, h) => ipcRenderer.send('set-size', w, h),
  siteIcon: (req) => ipcRenderer.invoke('site-icon', req),
  cacheImage: (url, referer) => ipcRenderer.invoke('cache-image', url, referer),
  pageCover: (url) => ipcRenderer.invoke('page-cover', url),
  setBubbleSize: (n) => ipcRenderer.send('set-bubble-size', n),
  moveStart: () => ipcRenderer.send('move-start'),
  moveMove: () => ipcRenderer.send('move-move'),
  moveEnd: () => ipcRenderer.send('move-end'),
  openFolder: () => ipcRenderer.invoke('open-folder'),
  loadFolder: (f) => ipcRenderer.invoke('load-folder', f)
});
