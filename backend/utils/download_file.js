import fs from "fs";
import path from "path";
import { pipeline } from "stream";
import { promisify } from "util";
import { fetch } from "./fetch.js";

const streamPipeline = promisify(pipeline);

let download_temp_serial = 0;
let download_temp_prefix = new Date().toISOString().replace(/[:.]/g, "-");

export async function download_file(url, file_path = null) {
  const ext = path.extname(new URL(url).pathname) || "";
  file_path = file_path || path.resolve(`./.temp/download/${download_temp_prefix}-${download_temp_serial++}${ext}`);

  await fs.promises.mkdir(path.dirname(file_path), { recursive: true });

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download ${url}: ${response.statusText}`);
  }

  await streamPipeline(response.body, fs.createWriteStream(file_path));
  return file_path;
}