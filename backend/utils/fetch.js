import mfh from 'make-fetch-happen';
// const { fetch: fetch_mfh } = mfh;
const fetch_mfh = mfh.defaults({ cachePath: './.temp/fetch-cache' });
import { async_queue } from './async_queue.js';

const fetch_rsp = async (...args) => {
  let response = await fetch_mfh(...args);
  if (!response.ok) throw new Error(`HTTP error ${response.status}`);
  return response;
};

if (!global.instance_fetch_queue) { global.instance_fetch_queue = new async_queue(); }
export const get_async_queue = () => { return global.instance_fetch_queue; };
const queue = global.instance_fetch_queue;

export const fetch = async (...args) => {
  return queue.enqueue(async () => await fetch_rsp(...args));
}

















