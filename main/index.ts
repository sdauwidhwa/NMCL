import electron from 'electron';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bind_registered_api, generateTypeFiles, register_event, register_api } from './ipc-manager.js';
import { FooHelloData } from './dummy-types.js';

const { app, BrowserWindow, ipcMain } = electron;
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DEFS_DIR = join(__dirname, '../build-defs');


type FooHelloResult = {
  message: string;
};

async function fooHello(
  data: FooHelloData
): Promise<FooHelloResult> {
  const name = data.username && data.username.trim().length > 0 ? data.username : 'stranger';
  return { message: `hello, ${name}` };
}

register_api('fooHello', fooHello);

type FooLongData = {
  interval: number;
  stepCount: number;
};
type FooLongProgress = {
  currentTime: number;
};
type FooLongResult = {
  actualTimeUsed: number;
};

async function fooLongAbortable(
  data: FooLongData,
  onProgress?: (message: FooLongProgress) => void,
  abortSignal?: AbortSignal
): Promise<FooLongResult> {
  const start = performance.now();

  const sleep = (ms: number) => new Promise<void>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const abortHandler = () => {
      if (timer) {
        clearTimeout(timer);
      }
      const err = new Error('Aborted');
      err.name = 'AbortError';
      reject(err);
    };
    timer = setTimeout(() => {
      if (abortSignal) {
        abortSignal.removeEventListener('abort', abortHandler);
      }
      resolve();
    }, ms);

    if (abortSignal) {
      if (abortSignal.aborted) {
        abortHandler();
        return;
      }
      abortSignal.addEventListener('abort', abortHandler, { once: true });
    }
  });

  const stepMs = data.interval * 1000;
  const progressIndex = Math.max(0, Math.floor(data.stepCount / 2) - 2);
  for (let i = 0; i < data.stepCount; i += 1) {
    await sleep(stepMs);
    if (onProgress && i === progressIndex) {
      const elapsed = Number(((performance.now() - start) / 1000).toFixed(3));
      onProgress({ currentTime: elapsed });
    }
  }

  const totalSeconds = Number(((performance.now() - start) / 1000).toFixed(3));
  return { actualTimeUsed: totalSeconds };
}

register_api('fooLongAbortable', fooLongAbortable);

register_api("fooLongAbortable2", async (arg: { steps: number, interval: number }, onProgress?: (msg: { message: string }) => void, abortSignal?: AbortSignal) => {
  function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  if (onProgress) onProgress({ message: `${0}/${arg.steps}` });
  for (let i = 0; i < arg.steps; i++) {
    if (abortSignal && abortSignal.aborted) {
      const err = new Error('Aborted');
      err.name = 'AbortError';
      throw err;
    }

    console.log(`Started on ${i}`);
    await sleep(arg.interval);
    if (onProgress) onProgress({ message: `${i + 1}/${arg.steps}` });
  }
  return "finished";
});

const CLOCK_CHANNEL = 'clock';
type ClockPayload = { iso: string; epochMs: number };
register_event<ClockPayload>(CLOCK_CHANNEL);

function startClock(win: electron.BrowserWindow): () => void {
  const timer = setInterval(() => {
    if (win.isDestroyed()) return;
    win.webContents.send(CLOCK_CHANNEL, {
      iso: new Date().toISOString(),
      epochMs: Date.now()
    } satisfies ClockPayload);
  }, 1000);

  win.on('closed', () => clearInterval(timer));
  return () => clearInterval(timer);
}


async function createWindow(preloadPath: string): Promise<void> {
  const win = new BrowserWindow({
    width: 960,
    height: 720,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
    }
  });
  startClock(win);
  win.minimize();

  if (app.isPackaged) {
    const p = join(__dirname, "..", "build-renderer", "index.html");
    await win.loadFile(p);
  } else {
    await win.loadURL(process.env.VITE_DEV_SERVER_URL ?? 'http://localhost:5173');
  }
}

async function main(): Promise<void> {
  if (process.argv.includes('--export-types')) {
    generateTypeFiles(DEFS_DIR);
    return;
  }

  await app.whenReady();

  bind_registered_api(ipcMain);
  await createWindow(join(DEFS_DIR, "preload.js"));

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });
}

void main().catch(err => {
  console.error(err);
  app.quit();
});

