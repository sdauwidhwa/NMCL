import { start } from './app.js'

// import { checkJavaInstalled } from './mclauncher/jdk.js';
// import { modrinth } from './mclauncher/mods.js';


// // console.log(await checkJavaInstalled());


// const hits = (await modrinth.search_mods({ query: "iris", offset: 0, limit: 5 })).hits;
// // console.log(hits);
// console.log(hits[0].project_id);

// const mod_info = await modrinth.get_mod_info({ project_id: hits[0].project_id });
// // console.log(mod_info);
// // console.log(mod_info[0]);

// const mod_version_info = await modrinth.get_mod_version_info({ version_id: mod_info[0].id });
// console.log(mod_version_info);

start();


