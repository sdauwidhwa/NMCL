import { spawn } from 'child_process';
import fs from 'fs';
import path, { join as pjoin } from 'path';
import { format } from 'date-fns';
import adm_zip from 'adm-zip';

import { fetch, download_file, object_file_mapper } from '../utils/common.js';
import { event_bridge } from '../app.js';

import { evaluate_manifest } from './rules.js';
import { use_account } from './auth.js';


const DIR_MC = pjoin(process.cwd(), '.minecraft');
const DIR_INSTS = pjoin(DIR_MC, "versions");
const DIR_LIBS = pjoin(DIR_MC, "libraries");
const DIR_ASSETS = pjoin(DIR_MC, "assets");
const DIR_ASSETS_INDEX = pjoin(DIR_ASSETS, "indexes");
const DIR_ASSETS_OBJS = pjoin(DIR_ASSETS, "objects");
const PATH_ACCOUNT_JSON = pjoin(DIR_MC, "accounts.json");
export const mc_account_file = new object_file_mapper(PATH_ACCOUNT_JSON, () => { return { next: 1, accounts: {} } });




const list_vanilla = async () => {
  const response = await (await fetch("https://piston-meta.mojang.com/mc/game/version_manifest_v2.json")).json();
  return response.versions;
}



const list_fabrics = async (vanilla) => {
  const response = await (await fetch(`https://meta.fabricmc.net/v2/versions/loader/${vanilla}`)).json();
  return response;
}



const fetch_manifest_vanilla = async (vanilla) => {
  const versions = await list_vanilla();
  let version = versions.filter(e => e.id === vanilla);
  if (version.length === 0) throw new Error("Invalid version");
  version = version[0];
  return await (await fetch(version.url)).json();
};

const fetch_manifest_fabrics = async (vanilla, fabrics) => {
  const url = `https://meta.fabricmc.net/v2/versions/loader/${vanilla}/${fabrics}/profile/json`;
  const manifest = await (await fetch(url)).json();
  manifest.libraries = manifest.libraries.map(lib => {
    if (!lib.downloads) {
      if (lib.url && lib.name) {
        const splitted = lib.name.split(":");
        if (splitted.length === 3) {
          const [org, name, ver] = splitted;
          const org2 = org.replaceAll(".", "/");
          const path = `${org2}/${name}/${ver}/${name}-${ver}.jar`;
          const url = `${lib.url}${lib.url.endsWith('/') ? "" : "/"}${path}`;
          lib.downloads = lib.downloads || {};
          lib.downloads.artifact = { path, url, };
        }
      }
    }
    if (!lib.downloads || !lib.downloads.artifact) {
      throw new Error(`Unrecognized manifest format. ${lib}`);
    }
    return lib;
  });
  return manifest;
};

const fetch_manifest = async (vanilla_version, modloader_type, modloader_version) => {
  if (vanilla_version && modloader_type === "Fabrics" && modloader_version) {
    return await fetch_manifest_fabrics(vanilla_version, modloader_version);

  } else if (vanilla_version && !modloader_type && !modloader_version) {
    return await fetch_manifest_vanilla(vanilla_version);

  } else {
    throw new Error(`Invalid version ${[vanilla_version, modloader_type, modloader_version]}`);
  }
}



const compose_manifest = async (vanilla_version, modloader_type, modloader_version) => {

  let patches = [
    await fetch_manifest(vanilla_version, modloader_type, modloader_version)
  ];
  for (let inheritsFrom = patches[0].inheritsFrom; inheritsFrom;) {
    const cur = await fetch_manifest(inheritsFrom, null, null);
    patches.push(cur);
    inheritsFrom = cur.inheritsFrom;
  }
  const is_plain_object = (value) => {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  const deep_merge = (obj_base, obj_over) => {
    const result = { ...obj_base };

    for (const [key, value_over] of Object.entries(obj_over)) {
      const value_base = obj_base[key];
      if (value_over === undefined || value_over === null) continue;

      if (Array.isArray(value_over) && Array.isArray(value_base)) {
        result[key] = [...value_base, ...value_over];
      } else if (is_plain_object(value_base) && is_plain_object(value_over)) {
        result[key] = deep_merge(value_base, value_over);
      } else {
        result[key] = value_over;
      }
    }

    return result;
  };

  let manifest = {};
  for (let i = patches.length - 1; i >= 0; i--) {
    manifest = deep_merge(manifest, patches[i]);
  }


  return { manifest, patches };

};


const get_resource_index_path = (inst_name) => {
  return pjoin(DIR_ASSETS_INDEX, inst_name + '.json');
};

const download_resources = async ({ inst_name, event_callback }) => {
  const dir_inst = pjoin(DIR_INSTS, inst_name);
  const manifest = evaluate_manifest(JSON.parse(await fs.promises.readFile(pjoin(dir_inst, "manifest.json"))));

  let item_count_total = 0;
  let item_count_finished = 0;
  let update_last_time = 0;
  const update = () => {
    const now = performance.now();
    if (item_count_finished === item_count_total || now - update_last_time > 20) {
      update_last_time = now;
      event_callback(["counts", [item_count_finished, item_count_total]]);
    }
  };
  const download_file_tracked = async (...args) => {
    item_count_total += 1;
    update();
    await download_file(...args);
    item_count_finished += 1;
    update();
  };

  let waitfor = [];
  waitfor.push((async () => {
    await download_file_tracked(manifest.assetIndex.url, get_resource_index_path(inst_name));

    const asset_index = JSON.parse(await fs.promises.readFile(get_resource_index_path(inst_name)));
    const BASE_URL = "https://resources.download.minecraft.net";
    await Promise.all(Object.entries(asset_index.objects).map(async ([name, { hash: sha1, size }]) => {
      const sha1_first2 = sha1.substring(0, 2);
      const url = `${BASE_URL}/${sha1_first2}/${sha1}`;
      const file_path = pjoin(DIR_ASSETS_OBJS, sha1_first2, sha1);
      await download_file_tracked(url, file_path, { sha1, size });
    }));
  })());

  waitfor.push(download_file_tracked(manifest.downloads.client.url, pjoin(dir_inst, "client.jar")));
  waitfor.push(download_file_tracked(manifest.downloads.server.url, pjoin(dir_inst, "server.jar")));
  waitfor.push((async () => {
    return Promise.all((manifest.libraries || []).map(async (lib) => {
      await download_file_tracked(lib.downloads.artifact.url, pjoin(DIR_LIBS, lib.downloads.artifact.path));
    }));
  })());
  await Promise.all(waitfor);
};

const list_instance = async () => {
  await fs.promises.mkdir(DIR_INSTS, { recursive: true });
  return (await fs.promises.readdir(DIR_INSTS, { withFileTypes: true }))
    .filter(item => item.isDirectory())
    .map(item => item.name);
};

const create_instance = async ({ inst_name, version: [vanilla, modloader_type, modloader_version], event_callback }) => {
  if (inst_name == "") throw new Error("Insance name could not be empty.");
  if ((await list_instance()).includes(inst_name)) throw new Error("Instance already exists.");

  let { manifest, patches } = await compose_manifest(vanilla, modloader_type, modloader_version);


  manifest.id = inst_name;
  const DIR_CUR_INST = pjoin(DIR_INSTS, inst_name);

  await fs.promises.mkdir(pjoin(DIR_CUR_INST), { recursive: true });
  await fs.promises.writeFile(pjoin(DIR_CUR_INST, 'manifest.json'), JSON.stringify(manifest));
  await fs.promises.writeFile(pjoin(DIR_CUR_INST, 'manifest_patches.json'), JSON.stringify(patches));

  await download_resources({ inst_name, event_callback });
};


export const launch_instance = async ({ inst_name, selected_account }) => {
  const acc = await use_account(selected_account);

  const DIR_CUR_INST = pjoin(DIR_INSTS, inst_name);
  const manifest = evaluate_manifest(JSON.parse(await fs.promises.readFile(pjoin(DIR_CUR_INST, "manifest.json"))));
  await fs.promises.writeFile(pjoin(DIR_CUR_INST, 'manifest_evaluated.json'), JSON.stringify(manifest));
  const DIR_NATIVE = pjoin(DIR_CUR_INST, "natives");

  const buildClasspath = (libraries) => {
    return libraries.filter(lib => lib.name)
      .map(lib => {
        const [group, name, version] = lib.name.split(':');
        const jarName = `${name}-${version}.jar`;
        const groupPath = group.replace(/\./g, '/');
        return pjoin(DIR_LIBS, groupPath, name, version, jarName);
      });
  };

  // unpack native
  fs.mkdirSync(DIR_NATIVE, { recursive: true });
  manifest.libraries.forEach(lib => {
    const [platform, lib_suffix] =
      process.platform === 'win32' ? ['natives-windows', '.dll'] :
        process.platform === 'darwin' ? ['natives-macos', '.dylib'] :
          process.platform === 'linux' ? ['natives-linux', '.so'] : null;


    const lib_name_split = lib.name.split(":");

    if (lib_name_split.length == 4 && lib_name_split[3] === platform) {
      const nativeJarBuffer = fs.readFileSync(pjoin(DIR_LIBS, lib.downloads.artifact.path));
      const zip = new adm_zip(nativeJarBuffer);


      zip.getEntries().forEach(entry => {
        if (entry.entryName.endsWith(lib_suffix) || entry.entryName.endsWith('.so')) {
          const unpack_path = pjoin(DIR_NATIVE, path.basename(entry.entryName));
          fs.writeFileSync(unpack_path, entry.getData());
        }
      });
    }
  });

  const normalizeArgs = (args) => {
    return args.flatMap(arg => {
      if (Array.isArray(arg)) return arg; // If arg is an array, spread it
      if (typeof arg === 'string') return [arg]; // If string, wrap in array
      return []; // Ignore invalid args
    });
  };


  // Build classpath
  const deduplicateLibraries = (libs) => {
    const map = new Map();
    for (const lib of libs) {
      const split = lib.name.split(":");
      map.set(`${split[0]}:${split[1]}`, lib);
    }
    return Array.from(map.values());
  };
  const classpath = [
    ...buildClasspath(deduplicateLibraries(manifest.libraries)),
    pjoin(DIR_CUR_INST, 'client.jar'),
  ].join(process.platform === 'win32' ? ';' : ':');

  // Normalize JVM and game arguments
  const jvmArgs = normalizeArgs(manifest.arguments?.jvm || []);
  const gameArgs = normalizeArgs(manifest.arguments?.game || []);

  // Replace placeholders in arguments (common Minecraft placeholders)
  const replacePlaceholders = (arg) => {
    arg = arg
      .replace('${natives_directory}', DIR_NATIVE)
      .replace('${launcher_name}', 'CustomLauncher')
      .replace('${launcher_version}', '1.0')
      .replace('${classpath}', classpath)
      .replace('${assets_root}', DIR_ASSETS)
      .replace('${assets_index_name}', manifest.assetIndex?.id ? inst_name : 'legacy')
      .replace('${user_type}', 'mojang')
      .replace('${version_name}', manifest.id || 'unknown')
      .replace('${version_type}', manifest.type || 'release')
      .replace('${game_directory}', DIR_CUR_INST)
      .replace('${resolution_width}', '854')
      .replace('${resolution_height}', '480');

    if (selected_account) {
      arg = arg
        .replace('${auth_uuid}', acc.uuid)
        .replace('${auth_access_token}', acc.access_token)
        .replace('${auth_player_name}', acc.username)
    } else {
      arg = arg
        .replace('${auth_uuid}', '00000000-0000-0000-0000-000000000000')
        .replace('${auth_access_token}', '0')
        .replace('${auth_player_name}', 'player')
    }

    return arg;
  };

  // Prepare final arguments
  const finalJvmArgs = jvmArgs.map(replacePlaceholders);
  const finalGameArgs = gameArgs.map(replacePlaceholders);

  // Construct the full command
  const final_args = [
    ...finalJvmArgs,
    // '-cp', classpath,
    manifest.mainClass || 'net.minecraft.client.main.Main',
    ...finalGameArgs,
  ];

  await fs.promises.writeFile(pjoin(DIR_CUR_INST, "launch_args.json"), JSON.stringify(final_args));

  // Spawn the Java process
  const javaProcess = spawn('java', final_args, {
    cwd: DIR_CUR_INST,
    stdio: ['pipe', 'pipe', 'pipe'], // Capture stdout and stderr
  });

  const logs = [];

  javaProcess.stdout.on('data', (data) => {
    logs.push({
      timestamp: new Date().toISOString(),
      type: 'stdout',
      message: data.toString(),
    });
  });

  javaProcess.stderr.on('data', (data) => {
    logs.push({
      timestamp: new Date().toISOString(),
      type: 'stderr',
      message: data.toString(),
    });
  });


  const timestamp = format(new Date(), 'yyyy-MM-dd\'T\'HHmm');
  const PATH_lOG_FILE = pjoin(DIR_CUR_INST, 'nmcllog', `${timestamp}.json`);
  await fs.promises.mkdir(pjoin(DIR_CUR_INST, 'nmcllog'), { recursive: true });

  javaProcess.on('close', (code) => {
    logs.push({
      timestamp: new Date().toISOString(),
      type: 'exit',
      code,
    });
    try {
      fs.writeFileSync(PATH_lOG_FILE, JSON.stringify(logs, null, 2));
    } catch (err) {
      console.error(`Failed to write log file: ${err.message}`);
    }
  });

  javaProcess.on('error', (err) => {
    logs.push({
      timestamp: new Date().toISOString(),
      type: 'error',
      message: err.message,
    });
    try {
      fs.writeFileSync(PATH_lOG_FILE, JSON.stringify(logs, null, 2));
    } catch (err) {
      console.error(`Failed to write log file: ${err.message}`);
    }
  });

  // return javaProcess;
};

event_bridge.register_members("", {
  list_instance,
  list_vanilla: async () => {
    const response = await list_vanilla();
    return {
      candidates: response.map(e => { return { id: e.id, type: e.type } }),
      filter_options: [...new Set(response.map(e => e.type))],
      initial_filter_options: ["release"],
    };
  },
  list_fabrics: async ({ vanilla }) => {
    const response = await list_fabrics(vanilla);
    const STABLE = "stable";
    const NONSTABLE = "non-stable";
    return {
      candidates: response.map(e => { return { id: e.loader.version, type: e.loader.stable ? STABLE : NONSTABLE } }),
      filter_options: [STABLE, NONSTABLE],
      initial_filter_options: [STABLE],
    };
  },
  create_instance,
  launch_instance,
  dummy_progressed_task: async ({ event_callback }) => {
    const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    for (let i = 0; i < 10; i++) {
      event_callback({ i });
      await delay(500);
    }
  },
});



