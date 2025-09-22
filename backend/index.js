import electron from "electron";
import path from "path";
import url from 'url';

import { preloader } from './preloader.js';
import * as _ from './mclauncher/core.js';

(async () => {

    await preloader.make_preload();


    function createWindow() {
        const win = new electron.BrowserWindow({
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
            win.loadURL("http://localhost:5173");
            win.maximize();
            win.webContents.openDevTools();
        } else {
            const dirname = path.dirname(url.fileURLToPath(import.meta.url));
            win.loadFile(path.join(dirname, "..", "dist", "index.html"));
        }


    }

    electron.app.whenReady().then(() => {
        createWindow();

        electron.app.on("activate", () => {
            if (electron.BrowserWindow.getAllWindows().length === 0) createWindow();
        });
    });

    electron.app.on("window-all-closed", () => {
        if (process.platform !== "darwin") electron.app.quit();
    });


})();
