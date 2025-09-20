import { spawn } from 'child_process';
import fs from 'fs';
import path, { join as pjoin } from 'path';
import { format } from 'date-fns';
import AdmZip from 'adm-zip';

import { download_file } from '../utils/download_file.js';
import { fetch } from '../utils/fetch.js'
import { preloader } from '../preloader.js';
import { evaluate_manifest } from './rules.js';




const DIR_MC = pjoin(process.cwd(), '.minecraft');
const DIR_INSTS = pjoin(DIR_MC, "versions");
const DIR_LIBS = pjoin(DIR_MC, "libraries");
const DIR_ASSETS = pjoin(DIR_MC, "assets");
const DIR_ASSETS_INDEX = pjoin(DIR_ASSETS, "indexes");
const DIR_ASSETS_OBJS = pjoin(DIR_ASSETS, "objects");




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
  console.log("fetch_manifest", vanilla_version, modloader_type, modloader_version);
  if (vanilla_version && modloader_type === "Fabrics" && modloader_version) {
    return await fetch_manifest_fabrics(vanilla_version, modloader_version);

  } else if (vanilla_version && !modloader_type && !modloader_version) {
    return await fetch_manifest_vanilla(vanilla_version);

  } else {
    throw new Error(`Invalid version ${[vanilla_version, modloader_type, modloader_version]}`);

  }
}

const deep_merge = (obj_base, obj_over) => {
  // Merge objects according to Minecraft manifest rules
  const result = { ...obj_base };

  for (const [key, value_over] of Object.entries(obj_over)) {
    const value_base = obj_base[key];
    if (value_over === undefined || value_over === null) continue;

    if (Array.isArray(value_over) && Array.isArray(value_base)) {
      result[key] = [...value_base, ...value_over];
    } else if (
      typeof value_over === "object" &&
      !Array.isArray(value_over) &&
      typeof value_base === "object" &&
      value_base !== null
    ) {
      // Deep merge for objects (like "arguments")
      result[key] = deep_merge(value_base, value_over);
    } else {
      // Primitive or replace case
      result[key] = value_over;
    }
  }

  return result;
};

const compose_manifest = async (vanilla_version, modloader_type, modloader_version) => {
  // Collect chain of manifests: child first, then parents
  let patches = [
    await fetch_manifest(vanilla_version, modloader_type, modloader_version)
  ];

  for (let inheritsFrom = patches[0].inheritsFrom; inheritsFrom;) {
    const cur = await fetch_manifest(inheritsFrom, null, null);
    patches.push(cur);
    inheritsFrom = cur.inheritsFrom;
  }

  let manifest = {};
  for (let i = patches.length - 1; i >= 0; i--) {
    manifest = deep_merge(manifest, patches[i]);
  }


  return { manifest, patches };

};


const get_resource_index_path = (inst_name) => {
  return pjoin(DIR_ASSETS_INDEX, inst_name + '.json');
};

const download_resources = async (inst_name) => {
  const dir_inst = pjoin(DIR_INSTS, inst_name);
  const manifest = evaluate_manifest(JSON.parse(await fs.promises.readFile(pjoin(dir_inst, "manifest.json"))));

  let waitfor = [];
  waitfor.push((async () => {
    await download_file(manifest.assetIndex.url, get_resource_index_path(inst_name));
    const asset_index = JSON.parse(await fs.promises.readFile(get_resource_index_path(inst_name)));
    const BASE_URL = "https://resources.download.minecraft.net";
    await Promise.all(Object.entries(asset_index.objects).map(async ([name, { hash }]) => {
      const hash2 = hash.substring(0, 2);
      const url = `${BASE_URL}/${hash2}/${hash}`;
      const file_path = pjoin(DIR_ASSETS_OBJS, hash2, hash);
      await download_file(url, file_path);
    }));
  })());

  waitfor.push(download_file(manifest.downloads.client.url, pjoin(dir_inst, "client.jar")));
  waitfor.push(download_file(manifest.downloads.server.url, pjoin(dir_inst, "server.jar")));
  waitfor.push((async () => {
    return Promise.all((manifest.libraries || []).map(lib => {
      return download_file(lib.downloads.artifact.url, pjoin(DIR_LIBS, lib.downloads.artifact.path));
    }));
  })());
  await Promise.all(waitfor);
  console.log("Creation complete");
};

const list_instance = async () => {
  await fs.promises.mkdir(DIR_INSTS, { recursive: true });
  return (await fs.promises.readdir(DIR_INSTS, { withFileTypes: true }))
    .filter(item => item.isDirectory())
    .map(item => item.name);
};

const create_instance = async (inst_name, [vanilla, modloader_type, modloader_version]) => {

  let { manifest, patches } = await compose_manifest(vanilla, modloader_type, modloader_version);


  manifest.id = inst_name;
  const DIR_CUR_INST = pjoin(DIR_INSTS, inst_name);

  await fs.promises.mkdir(pjoin(DIR_CUR_INST), { recursive: true });
  await fs.promises.writeFile(pjoin(DIR_CUR_INST, 'manifest.json'), JSON.stringify(manifest));
  await fs.promises.writeFile(pjoin(DIR_CUR_INST, 'manifest_patches.json'), JSON.stringify(patches));
  
  await download_resources(inst_name);  
};


export const launch_instance = async (inst_name) => {
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
    const platform = process.platform === 'win32' ? 'natives-windows' :
      process.platform === 'darwin' ? 'natives-macos' :
        process.platform === 'linux' ? 'natives-linux' : null;

    const lib_name_split = lib.name.split(":");

    if (lib_name_split.length == 4 && lib_name_split[3] === platform) {
      // console.log("found native:", lib.name);
      const nativeJarBuffer = fs.readFileSync(pjoin(DIR_LIBS, lib.downloads.artifact.path));
      const zip = new AdmZip(nativeJarBuffer);


      zip.getEntries().forEach(entry => {
        if (entry.entryName.endsWith('.dll')) {
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
    // console.log(map);
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
    return arg
      .replace('${natives_directory}', DIR_NATIVE)
      .replace('${launcher_name}', 'CustomLauncher')
      .replace('${launcher_version}', '1.0')
      .replace('${classpath}', classpath)
      .replace('${assets_root}', DIR_ASSETS)
      // .replace('${assets_index_name}', evaluated_manifest.assetIndex?.id || 'legacy')
      .replace('${assets_index_name}', inst_name || 'legacy')
      .replace('${auth_uuid}', '00000000-0000-0000-0000-000000000000')
      .replace('${auth_access_token}', '0')
      .replace('${auth_player_name}', 'player')
      .replace('${user_type}', 'mojang')
      .replace('${version_name}', manifest.id || 'unknown')
      .replace('${version_type}', manifest.type || 'release')
      .replace('${game_directory}', DIR_CUR_INST)
      .replace('${resolution_width}', '854')
      .replace('${resolution_height}', '480');
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

preloader.register_members("", {
  list_instance,
  list_vanilla: async () => {
    const response = await list_vanilla();
    return {
      candidates: response.map(e => { return { id: e.id, type: e.type } }),
      filter_options: [...new Set(response.map(e => e.type))],
      initial_filter_options: ["release"],
    };
  },
  list_fabrics: async (...args) => {
    const response = await list_fabrics(...args);
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
});

// preloader.register_many("", [
//   list_instance,
//   list_vanilla,
//   list_fabrics,
//   create_instance,
//   launch_instance,
// ]);



