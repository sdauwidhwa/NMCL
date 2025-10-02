import path from "path";
import url from 'url';
import fs from 'fs';
import electron, { ipcMain } from "electron";


let main_window = null;
const event_registry = new Map();



export const event_bridge = {

  register(path, func) {
    ipcMain.handle(path, (event, arg) => {
      const event_path = arg?.event_path;
      const event_callback = typeof (event_path) === 'string'
        ? (...args) => { send(event_path, ...args); }
        : () => { };
      return func({ ...arg, event_callback });
      // return func({ ...arg, event_callback }, event_callback);
      // if (typeof (event_path) === 'string') {
      //   return func({ ...arg, event_callback: (...args) => { send(event_path, ...args); } });
      // } else {
      //   return func({ ...arg, event_callback: () => { } });
      // }
    });
    event_registry.set(path, func);
  },

  register_many(prefix, funcs) {
    funcs.forEach(e => {
      this.register(prefix + e.name, e);
    });
  },

  register_members(prefix, obj) {
    Object.entries(obj).forEach(([key, value]) => {
      if (typeof value === "function") {
        this.register(prefix + key, value);
      }
    });
  },

  get_preload_path() {
    return path.join(process.cwd(), "./.temp/preload.js");
  },

  async make_preload() {
    let listString = [...event_registry.keys()].map(e => `"${e}"`).join(",\n");
    let content = `
const list = [\n${listString}\n];
const { contextBridge, ipcRenderer } = require('electron');
function buildObjectFromList(list) {
  const root = {};

  for (const path of list) {
    const parts = path.split(".");
    let current = root;

    // Traverse or create nested objects
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];

      if (i === parts.length - 1) {
        // Leaf: assign function
        current[part] = (...args) =>
          ipcRenderer.invoke(path, ...args);
      } else {
        // Intermediate: ensure object exists
        if (!current[part]) current[part] = {};
        current = current[part];
      }
    }
  }
  return root;
};
contextBridge.exposeInMainWorld('api', {
  ...buildObjectFromList(list),
});
contextBridge.exposeInMainWorld('event_bridge', {
  onEvent: (callback) => {
    ipcRenderer.on("event", (event, ...message) => callback(...message));
  }
});
`;
    await fs.promises.mkdir(path.dirname(this.get_preload_path()), { recursive: true });
    return await fs.promises.writeFile(this.get_preload_path(), content);
  },
};


export const start = async () => {

  await import('./mclauncher/core.js');
  await event_bridge.make_preload();


  function createWindow() {
    main_window = new electron.BrowserWindow({
      width: 768,
      height: 1024,
      webPreferences: {
        // preload: path.join(__dirname, "preload.js"),
        preload: event_bridge.get_preload_path(),
        nodeIntegration: false,
        contextIsolation: true,
        webSecurity: true,
      },
    });


    if (process.env.NODE_ENV === "development") {
      main_window.loadURL("http://localhost:5173");
      main_window.maximize();
      main_window.webContents.openDevTools();
    } else {
      const dirname = path.dirname(url.fileURLToPath(import.meta.url));
      main_window.loadFile(path.join(dirname, "..", "dist", "index.html"));
    }

  }

  electron.app.whenReady().then(() => {
    createWindow();

    electron.app.on("activate", () => {
      if (electron.BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  });

  electron.app.on("window-all-closed", () => {
    if (process.platform !== "darwin") electron.app.quit();
  });

};

export const send = (path, obj) => {

  if (!(main_window && main_window.webContents)) {
    throw new Error("Could not send event. Main window null.");
  }
  main_window.webContents.send("event", path, obj);

};





