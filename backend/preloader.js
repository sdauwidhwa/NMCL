
import { ipcMain } from 'electron';
import fs from 'fs';
import path from 'path';


if (!global.instance_preloader_registry) { global.instance_preloader_registry = new Map(); }
const registry = global.instance_preloader_registry;

export const preloader = {

  register(path, func) {
    console.log(`Registering ${path}`);
    ipcMain.handle(path, (event, ...args) => { console.log(...args); return func(...args); });
    registry.set(path, func);
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
    let listString = [...registry.keys()].map(e => `"${e}"`).join(",\n");
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
contextBridge.exposeInMainWorld('api', buildObjectFromList(list));`;
    await fs.promises.mkdir(path.dirname(this.get_preload_path()), { recursive: true });
    return await fs.promises.writeFile(this.get_preload_path(), content);
  },
};









