import fs from "fs";
import make_fetch_happen from 'make-fetch-happen';
import path from "path";
import { pipeline } from "stream";
import { promisify } from "util";
import crypto from "crypto";


export class async_queue {
  constructor() {
    this.limit = 10;
    this.active = 0;
    this.queue = [];
  }

  enqueue = (workload) => {
    return new Promise((resolve, reject) => {
      const task = () => {
        this.active++;
        workload().then(resolve).catch(reject).finally(() => {
          this.active--;
          if (this.queue.length > 0 && this.active < this.limit) {
            this.queue.shift()();
          }
        });
      };

      if (this.active < this.limit) {
        task();
      } else {
        this.queue.push(task);
      }
    });
  };
}

const fetch_queue = new async_queue();
const make_fetch_happen_fetch = make_fetch_happen.defaults({ retry: 2, cachePath: './.temp/fetch-cache' });
export const fetch = async (url, options = {}) => {
  options = {
    ...options,
    headers: {
      'User-Agent': "sdauwidhwa/NMCL(nodejs.minecraft.launcher@gmail.com)",
      ...(options.headers || {}),
    },
  };
  return fetch_queue.enqueue(async () => {
    let response = await make_fetch_happen_fetch(url, options);
    if (!response.ok) throw new Error(`HTTP error ${response.status}`);
    return response;
  });
}




const download_temp = {
  serial: 0,
  prefix: new Date().toISOString().replace(/[:.]/g, "-"),
};
export async function download_file(url, file_path = null, expected = {}) {

  // Make default path
  if (file_path === null) {
    const url_obj = new URL(url);
    const ext = path.extname(url_obj.pathname) || '';
    file_path = path.resolve(`./.temp/download/${download_temp.prefix}-${download_temp.serial++}${ext}`);
  }

  // Returns true on match, false on mismatch and null on no test given.
  const check_file = async () => {
    try {
      const stats = await fs.promises.stat(file_path);
      if (!stats.isFile()) return false;

      if (expected.size || expected.size === 0) {
        if (stats.size !== expected.size) {
          return false;
        }
      }
    } catch (err) {
      if (err?.code === 'ENOENT') { return false; }
      throw err;
    }

    const known_algorithms = ['md5', 'sha1', 'sha256', 'sha512']
    const selected = Object.entries(expected).map(([k, v]) => k).filter(e => known_algorithms.includes(e));
    const result = await get_file_hash(file_path, selected);
    if (selected.some(e => result[e] !== expected[e])) {
      return false;
    }
    if (selected.length === 0 && !(expected.size || expected.size === 0)) {
      return null;
    }
    return true;
  };

  // Skip if already good
  if (check_file() === true) { return file_path; }

  // Create folder
  await fs.promises.mkdir(path.dirname(file_path), { recursive: true });

  // Download the file
  {
    const response = await fetch(url);
    const pipeline_prom = promisify(pipeline);
    await pipeline_prom(response.body, fs.createWriteStream(file_path));
  }

  // Verify
  if (check_file() === false) {
    throw new Error(`Downloaded file failed verification. ${file_path}`);
  }

  return file_path;
}



export const get_file_hash = async (input, algorithms = ['sha256']) => new Promise((resolve, reject) => {
  algorithms = Array.isArray(algorithms) ? algorithms : [algorithms];
  const known_algorithms = ['sha256', 'md5', 'sha1', 'sha512'];
  algorithms = algorithms.filter(e => known_algorithms.includes(e));
  if (algorithms.length === 0) { resolve({}); }

  let stream;
  if (typeof input === 'string') {
    stream = fs.createReadStream(input);
  } else if (input.readable) {
    stream = input;
  } else {
    throw new Error('Input must be a file path (string) or readable stream');
  }


  stream.on('error', (err) => { reject(err); });

  const hashes = algorithms.map(algorithm => ({ algorithm, hash: crypto.createHash(algorithm) }));

  stream.on('data', (chunk) => {
    hashes.forEach(({ hash }) => {
      hash.update(chunk);
    });
  });

  let results = {};
  let remaining = algorithms.length;
  stream.on('end', () => {
    hashes.forEach(({ algorithm, hash }) => {
      results[algorithm] = hash.digest('hex');
      remaining--;
      if (remaining === 0) { resolve(results); }
    });
  });
});





