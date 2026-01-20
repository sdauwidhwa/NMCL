import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BrowserWindow, type IpcMain } from 'electron';
import { Project, SyntaxKind, ts } from 'ts-morph';
import type { Node, Type, TypeChecker, Symbol } from 'ts-morph';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const TSCONFIG_PATH = join(__dirname, '../main/tsconfig.json');




export type IpcApiHandler<TData, TProgress, TResult> = (data?: TData, onProgress?: (message: TProgress) => void, abortSignal?: AbortSignal) => Promise<TResult> | TResult;

export type IpcEventBroadcaster<TData> = (data?: TData) => void;

type RegApi = {
  channel: string;
  handler: IpcApiHandler<any, any, any>;

};

type RegApiInferred = {
  channel: string;
  data: string;
  progress: string;
  result: string;
  abortable: boolean;
};

type RegEvent = {
  channel: string;
};

type RegEventInferred = {
  channel: string;
  data: string;
};

type RegInferred = { apis: RegApiInferred[]; events: RegEventInferred[] };


const reg_api: RegApi[] = [];
const reg_event: RegEvent[] = [];

const MAX_RENDER_DEPTH = 16;
function renderType(type: Type<ts.Type>, node: Node, checker: TypeChecker, depth = 0, wrapFunction = false): string {
  if (depth > MAX_RENDER_DEPTH) return 'any';

  if (type.isString()) return 'string';
  if (type.isNumber()) return 'number';
  if (type.isBoolean()) return 'boolean';
  if (type.isUndefined()) return 'undefined';
  if (type.isNull()) return 'null';
  if (type.isAny()) return 'any';
  if (type.isUnknown()) return 'unknown';
  if (type.isVoid()) return 'void';

  if (type.isUnion()) {
    return type.getUnionTypes().map(t => renderType(t, node, checker, depth + 1, true)).join(' | ');
  }
  if (type.isIntersection()) {
    return type.getIntersectionTypes().map(t => renderType(t, node, checker, depth + 1, true)).join(' & ');
  }

  const promiseArg = type.getSymbol()?.getName() === 'Promise' ? type.getTypeArguments()[0] : undefined;
  if (promiseArg) { return `Promise<${renderType(promiseArg, node, checker, depth + 1)}>`; }

  if (type.isArray()) {
    const elementType = type.getArrayElementType() ?? type.getTypeArguments()[0];
    return `${elementType ? renderType(elementType, node, checker, depth + 1) : 'any'}[]`;
  }

  const callSig = type.getCallSignatures()[0];
  if (callSig) {
    const params = callSig.getParameters().map(param => {
      const paramType = checker.getTypeOfSymbolAtLocation(param, node);
      const rendered = renderType(paramType, node, checker, depth + 1);
      return `${param.getName()}: ${rendered}`;
    }).join(', ');
    const ret = renderType(callSig.getReturnType(), node, checker, depth + 1);
    const fnText = `(${params}) => ${ret}`;
    return wrapFunction ? `(${fnText})` : fnText;
  }

  const props = type.getProperties();
  if (props.length > 0) {
    const body = props.map(prop => {
      const decl = prop.getValueDeclaration() ?? prop.getDeclarations()[0];
      const isOptional = !!(prop.getFlags() & ts.SymbolFlags.Optional) ||
        (decl && 'hasQuestionToken' in decl && (decl as any).hasQuestionToken?.());
      const propType = checker.getTypeOfSymbolAtLocation(prop, node);
      const rendered = renderType(propType, node, checker, depth + 1);
      return `${prop.getName()}${isOptional ? '?' : ''}: ${rendered}`;
    }).join('; ');
    return `{ ${body} }`;
  }


  const alias = type.getAliasSymbol()?.getDeclaredType();
  if (alias && alias !== type) {
    return renderType(alias, node, checker, depth + 1, wrapFunction);
  }

  return type.getApparentType().getText(node, ts.TypeFormatFlags.NoTruncation);
}


export function register_api<THandler extends IpcApiHandler<any, any, any>>(
  channel: string, handler: THandler): void {
  reg_api.push({
    channel,
    handler: handler as IpcApiHandler<any, any, any>
  });
}

export function register_event<TPayload>(channel: string): (payload: TPayload) => void {
  if (!reg_event.find(e => e.channel === channel)) {
    reg_event.push({ channel });
  }
  return (payload: TPayload) => {
    const windows = BrowserWindow.getAllWindows();
    for (const win of windows) {
      if (!win.isDestroyed()) {
        win.webContents.send(channel, payload);
      }
    }
  };
}

export function bind_registered_api(ipcMain: IpcMain): void {
  for (const def of reg_api) {
    ipcMain.handle(def.channel, async (event, payload: {
      data: unknown;
      progressChannel?: string | null;
      abortChannel?: string | null;
    }) => {
      const parsedData = payload?.data as unknown;

      const abortChannel = payload?.abortChannel ?? null;
      const abortController = abortChannel ? new AbortController() : null;
      const abortListener = abortChannel ? () => abortController?.abort() : null;

      if (abortChannel && abortListener) { ipcMain.once(abortChannel, abortListener); }

      const progressChannel = payload?.progressChannel ?? null;
      const progress = progressChannel ? (message: unknown) => { event.sender.send(progressChannel, message); } : undefined;

      try {
        const result = await def.handler(parsedData, progress, abortController?.signal);
        return result;
      } finally {
        if (abortChannel && abortListener) {
          ipcMain.removeListener(abortChannel, abortListener);
        }
      }
    });
  }
}






function inferTypesFromSources(): RegInferred {
  const project = new Project({
    tsConfigFilePath: TSCONFIG_PATH,
    skipAddingFilesFromTsConfig: false
  });

  const checker = project.getTypeChecker();
  let res: RegInferred = { apis: [], events: [] }




  return res;
}

export function generateTypeFiles(outputDir: string): { preloadPath: string } {
  mkdirSync(outputDir, { recursive: true });

  const { apis, events } = inferTypesFromSources();

  const dtsBody = apis.map(api =>
    `  '${api.channel}': { data: ${api.data}; progress: ${api.progress}; result: ${api.result}; abortable: ${api.abortable ? 'true' : 'false'}; };`
  ).join('\n');
  const dtsEvents = events.map(evt =>
    `  '${evt.channel}': ${evt.data};`
  ).join('\n');

  const combinedDts = `

export type IpcDefinitions = {
${dtsBody}
};

export type EventDefinitions = {
${dtsEvents}
};

export type EventChannels = keyof EventDefinitions;

type ProgressPayload<K extends keyof IpcDefinitions> = IpcDefinitions[K]['progress'];
type ProgressArg<K extends keyof IpcDefinitions> = ProgressPayload<K> extends undefined ? never : ProgressPayload<K>;
type ProgressHandler<K extends keyof IpcDefinitions> = ProgressPayload<K> extends undefined ? undefined : (message: ProgressArg<K>) => void;

export type IpcApi = {
  [K in keyof IpcDefinitions]: (data: IpcDefinitions[K]['data'], onProgress?: ProgressHandler<K>, abortSignal?: AbortSignal) => Promise<IpcDefinitions[K]['result']>;
};

export type IpcApiAbortable = {
  [K in keyof IpcDefinitions as IpcDefinitions[K]['abortable'] extends true ? K : never]: (data: IpcDefinitions[K]['data'], onProgress?: ProgressHandler<K>) => { prom: Promise<IpcDefinitions[K]['result']>; abort: () => void; };
};

export type EventApi = {
  [K in keyof EventDefinitions]: (callback: (payload: EventDefinitions[K]) => void) => () => void;
};

declare global {
  interface Window {
    ipc_api: IpcApi & { abortable: IpcApiAbortable };
    ipc_events: EventApi;
  }
}

export {};

  `;


  const metaJson = JSON.stringify({
    ipc: apis,
    events
  }, null, 2);

  const preloadJs = `

'use strict';
const { contextBridge, ipcRenderer } = require('electron');
const meta = ${JSON.stringify(apis, null, 2)};
const events = ${JSON.stringify(events, null, 2)};
let __ipcCounter = 0;
const nextId = (prefix) => prefix + (++__ipcCounter);

function invoke(def, data, onProgress, abortSignal) {
  const progressChannel = onProgress ? nextId('ipc:progress:') : null;
  const abortChannel = abortSignal ? nextId('ipc:abort:') : null;

  const progressListener = progressChannel && onProgress
    ? (_event, payload) => onProgress(payload)
    : null;

  if (progressChannel && progressListener) {
    ipcRenderer.on(progressChannel, progressListener);
  }

  const abortListener = abortChannel && abortSignal
    ? () => ipcRenderer.send(abortChannel)
    : null;

  if (abortChannel && abortSignal && abortListener) {
    abortSignal.addEventListener('abort', abortListener, { once: true });
  }

  const promise = ipcRenderer.invoke(def.channel, { data, progressChannel, abortChannel });
  const cleanup = () => {
    if (progressChannel && progressListener) {
      ipcRenderer.removeListener(progressChannel, progressListener);
    }
    if (abortChannel && abortSignal && abortListener) {
      abortSignal.removeEventListener('abort', abortListener);
    }
  };

  promise.then(cleanup, cleanup);
  return promise;
}

const ipc_api = {};
const abortable = {};
const ipc_events = {};

for (const def of meta) {
  ipc_api[def.channel] = (data, onProgress, abortSignal) => invoke(def, data, onProgress, abortSignal);
  if (def.abortable) {
    abortable[def.channel] = (data, onProgress) => {
      const controller = new AbortController();
      return {
        prom: invoke(def, data, onProgress, controller.signal),
        abort: () => controller.abort()
      };
    };
  }
}

ipc_api.abortable = abortable;
contextBridge.exposeInMainWorld('ipc_api', ipc_api);

for (const ev of events) {
  ipc_events[ev.channel] = (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on(ev.channel, handler);
    return () => ipcRenderer.removeListener(ev.channel, handler);
  };
}

contextBridge.exposeInMainWorld('ipc_events', ipc_events);

  `;

  writeFileSync(join(outputDir, 'ipc-meta.json'), metaJson, 'utf8');
  writeFileSync(join(outputDir, 'preload.js'), preloadJs, 'utf8');

  writeFileSync(join(outputDir, 'preload.d.ts'), combinedDts, 'utf8');
  const legacyIpcDts = join(outputDir, 'ipc.d.ts');
  if (existsSync(legacyIpcDts)) {
    try {
      rmSync(legacyIpcDts);
    } catch {
      /* ignore cleanup failure */
    }
  }

  return { preloadPath: join(outputDir, 'preload.js') };
}
