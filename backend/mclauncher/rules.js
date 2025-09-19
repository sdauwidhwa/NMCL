import os from 'os';





export const evaluate_manifest = (manifest, env) => {

  env = {
    os: {
      name: (() => {
        switch (os.platform()) {
          case 'win32': return 'windows';
          case 'darwin': return 'osx';
          case 'linux': return 'linux';
          default: return null;
        }
      })(),
      version: os.release(),
      arch: os.arch()
    },
    features: {},

    ...env,
  };

  const evaluate_single_rule = (rule) => {
    // Check features
    if (rule.features) {
      for (const [feature, required] of Object.entries(rule.features)) {
        const hasFeature = !!env.features[feature];
        if (hasFeature !== !!required) return false;
      }
    }

    // Check OS
    if (rule.os) {
      const ruleos = rule.os;
      if (ruleos.name && env.os.name !== ruleos.name) return false;
      if (ruleos.version && !new RegExp(ruleos.version).test(env.os.version)) return false;
      if (ruleos.arch && !new RegExp(ruleos.arch).test(env.os.arch)) return false;
    }

    return true;
  };

  const evaluate_rules = (rules) => {
    if (!rules || rules.length === 0) return true;



    const hasAllowRules = rules.some((rule) => rule.action === 'allow');
    const hasMatchingDisallow = rules.some((rule) => rule.action === 'disallow' && evaluate_single_rule(rule));

    if (hasMatchingDisallow) return false;

    if (hasAllowRules) {
      return rules.some((rule) => rule.action === 'allow' && evaluate_single_rule(rule));
    }

    return true;
  };


  // Ensure manifest has the required fields, provide defaults if missing
  const result = {
    ...manifest,
    libraries: manifest.libraries ? manifest.libraries.map(lib => {
      // If library has rules, evaluate them
      if (lib.rules) {
        return evaluate_rules(lib.rules) ? lib : null;
      }
      return lib; // No rules, include by default
    }).filter(lib => lib !== null) : [], // Remove null entries

    arguments: {
      ...manifest.arguments,
      game: manifest.arguments?.game ? manifest.arguments.game.map(arg => {
        // Handle string arguments (no rules)
        if (typeof arg === 'string') return arg;
        // Handle object arguments with rules
        if (arg.rules) {
          return evaluate_rules(arg.rules) ? arg.value : null;
        }
        return arg.value; // No rules, include value by default
      }).filter(arg => arg !== null) : [], // Remove null entries

      jvm: manifest.arguments?.jvm ? manifest.arguments.jvm.map(arg => {
        // Handle string arguments (no rules)
        if (typeof arg === 'string') return arg;
        // Handle object arguments with rules
        if (arg.rules) {
          return evaluate_rules(arg.rules) ? arg.value : null;
        }
        return arg.value; // No rules, include value by default
      }).filter(arg => arg !== null) : [] // Remove null entries
    }
  };

  return result;
};






