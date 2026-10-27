const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("arcBridge", {
  state: () => ipcRenderer.invoke("state"),
  open: () => ipcRenderer.invoke("open"),
  save: (name, content) => ipcRenderer.invoke("save", name, content),
  install: () => ipcRenderer.invoke("install"),
  extension: () => ipcRenderer.invoke("extension"),
  help: () => ipcRenderer.invoke("help"),
  stage: (jobs) => ipcRenderer.invoke("stage", jobs),
  control: (id, action) => ipcRenderer.invoke("control", id, action),
  report: () => ipcRenderer.invoke("report"),
});
