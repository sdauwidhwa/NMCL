import electron from "electron";
import path from "path";
import url from 'url';

import { preloader } from './preloader.js';
import * as _ from './mclauncher/core.js';

let main_window = null;
export const start = async () => {

  await preloader.make_preload();


  function createWindow() {
    main_window = new electron.BrowserWindow({
      width: 768,
      height: 1024,
      webPreferences: {
        // preload: path.join(__dirname, "preload.js"),
        preload: preloader.get_preload_path(),
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