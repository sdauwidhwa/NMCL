
const handlers = {};

window.event_bridge.onEvent((path, data) => {
  const h = handlers[path];
  if (h) { h(data); }
});


export const register = (path, callback) => {
  handlers[path] = callback;
};

let next_unnamed = 1;
export const register_unnamed = (callback) => {
  const name = `unnamed-${next_unnamed++}`;
  register(name, callback);
  return name;
};

export const unregister = (path) => {
  handlers[path] = undefined;
};

const add_event_path_to_function = (func) => {
  return (arg, progress_callback = () => { }) => {

    const event_path = register_unnamed(progress_callback);

    try {
      const res = func({ ...arg, event_path });

      if (res && typeof res.then === "function") {
        return res.finally(() => unregister(event_path));
      } else {
        unregister(event_path);
        return res;
      }

    } catch (err) {
      unregister(event_path);
      throw err;
    }
  };
};

const convert_object = (obj) => {
  const result = {};

  for (const key in obj) {
    if (!obj.hasOwnProperty(key)) continue;

    const value = obj[key];

    if (typeof value === "function") {
      result[key] = add_event_path_to_function(value);
    } else if (value && typeof value === "object") {
      result[key] = convert_object(value);
    }
  }

  return result;
}

window.apie = convert_object(window.api);

