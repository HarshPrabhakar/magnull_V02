const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("magnull", {
  getAppInfo: () => ({
    name: "Mag-Null",
    version: "0.1.0",
    mode: "simulation"
  })
});
