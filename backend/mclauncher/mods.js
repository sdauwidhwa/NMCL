import fs from 'fs';
import path, { join as pjoin } from 'path';
import { fetch, download_file, object_file_mapper } from '../utils/common.js';





export const modrinth = {

  async search_mods({ query, offset, limit }) {
    const response = await fetch(
      `https://api.modrinth.com/v2/search?query=${encodeURIComponent(query)}&offset=${offset}&limit=${limit}`
    );
    const data = await response.json();
    const result = {
      ...data,
      hits: data.hits.map((h, i) => {
        return { ...h, index: i + offset };
      }),
    };
    return result;
  },

  async get_mod_info({ project_id, }) {
    const url = `https://api.modrinth.com/v2/project/${project_id}/version`;
    const res = await fetch(url);
    const versions = await res.json();
    return versions;

    // return versions.map(v => ({
    //   id: v.id,
    //   name: v.name,
    //   version_number: v.version_number,
    //   game_versions: v.game_versions,
    //   loaders: v.loaders
    // }));
  },

  async get_mod_version_info({version_id}) {
    const url = `https://api.modrinth.com/v2/version/${version_id}`;
    const res = await fetch(url);
    const version = await res.json();
    return version;

    return version.dependencies.map(dep => ({
      dependency_type: dep.dependency_type,
      project_id: dep.project_id,
      version_id: dep.version_id
    }));
  },

}










