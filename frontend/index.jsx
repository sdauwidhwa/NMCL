import React, { useState, useEffect, useRef } from "react";
import ReactDOM from 'react-dom/client';

import './event_bridge.js'
import { CompSingleSelectionScrolledFiltered, DynamicList, Notification } from "./lib.jsx";



let InstanceDetail = ({ inst_name }) => {
  return (<div>
    <div><span style={{ fontSize: "24px" }} > Instance {inst_name}</span></div>
    <div><button onClick={() => window.apie.launch_instance({ inst_name }, console.log)}>Launch!</button></div>
  </div >);
};



const PageInstanceCreation = ({ refreshInstances, listRef }) => {
  const NONE = "None";
  const FABRICS = "Fabrics";
  const MODLOADER_TYPES = [NONE, FABRICS];
  const [new_instance_name, set_new_instance_name] = useState("");

  const [vanilla_options, set_vanilla_options] = useState(null);
  const [vanilla_selected, set_vanilla_selected] = useState(null);
  const modloader_type_options = { candidates: MODLOADER_TYPES.map(e => { return { id: e, type: "" } }), filter_options: [], initial_filter_options: [] }
  const [modloader_type_selected, set_modloader_type_selected] = useState(null);
  const [modloader_version_options, set_modloader_version_options] = useState(null);
  const [modloader_version_selected, set_modloader_version_selected] = useState(null);

  useEffect(() => {
    (async () => { set_vanilla_options(await window.apie.list_vanilla()); })();
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function fetchOptions() {
      if (modloader_type_selected === FABRICS) {
        try {
          const options = await window.apie.list_fabrics({ vanilla: vanilla_selected });
          if (!cancelled) {
            set_modloader_version_options(options);
          }
        } catch (err) {
          console.error("Failed to load fabrics:", err);
        }
      } else if (modloader_type_selected === NONE) {
        set_modloader_version_options(null);
        set_modloader_version_selected(null);
      }
    }

    fetchOptions();

    return () => {
      cancelled = true;
    };
  }, [vanilla_selected, modloader_type_selected]);



  const comp_button_create_and_input_name = (<div>
    <button onClick={async () => {
      const notification_id = listRef.current.add_comp(Notification, {});

      try {
        const version = modloader_type_selected === NONE
          ? [vanilla_selected, null, null]
          : [vanilla_selected, modloader_type_selected, modloader_version_selected];
        await window.apie.create_instance({ inst_name: new_instance_name, version }, ([type, content]) => {
          if (type === "counts") {
            listRef.current.update_comp(notification_id, { message: `Downloading ${content[0]}/${content[1]}` });
          }
        });
        listRef.current.update_comp(notification_id, { closable: true, message: "Done", close_timeout: 15000 });
      } catch (err) {
        console.error(`Instance creation failed`, vanilla_selected, modloader_type_selected, modloader_version_selected, err);
        listRef.current.update_comp(notification_id, { closable: true, message: `Error: ${err.message}`, close_timeout: 15000 });
        throw err;
      }
      refreshInstances();
    }}>Create Instance</button>

    New Instance Name
    <input value={new_instance_name} onChange={({ target: { value } }) => set_new_instance_name(value.replace(/[<>:"/\\|?*]/g, ""))} />
  </div>);


  return (
    <div className="expand">
      <div><span style={{ fontSize: "24px" }} > Instance Creation</span></div>
      {comp_button_create_and_input_name}
      <div className="expand">

        {vanilla_options && <CompSingleSelectionScrolledFiltered
          onSelect={set_vanilla_selected}
          options={vanilla_options}
        />}

        {vanilla_options && <CompSingleSelectionScrolledFiltered
          onSelect={set_modloader_type_selected}
          options={modloader_type_options}
        />}

        {(vanilla_options && vanilla_selected && modloader_type_selected && modloader_version_options) && <CompSingleSelectionScrolledFiltered
          onSelect={set_modloader_version_selected}
          options={modloader_version_options}
        />}

      </div>
      {comp_button_create_and_input_name}

    </div >);
};



function App() {



  // instances
  const [instanceList, setInstanceList] = useState([]);
  const refreshInstances = async () => {
    try {
      setInstanceList(await window.apie.list_instance());
    } catch (error) {
      console.error('Failed to fetch instances:', error);
    }
  };
  useEffect(() => { refreshInstances(); return () => { }; }, []);

  // resize
  const [width, setWidth] = useState(250);
  const resizerRef = useRef(null);
  const isResizing = useRef(false);
  const onMouseMove = (e) => {
    if (isResizing.current) {
      const newWidth = e.clientX;
      if (newWidth > 150 && newWidth < 500) {
        setWidth(newWidth);
      }
    }
  };
  const onMouseUp = () => {
    isResizing.current = false;
    document.removeEventListener("mousemove", onMouseMove);
    document.removeEventListener("mouseup", onMouseUp);
  };
  const onMouseDown = () => {
    isResizing.current = true;
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  };

  // right panel
  let [content, setContent] = useState(<div>
    <h1>Minecraft Launcher</h1>
    <p>Welcome to NMCL!</p>
  </div>);

  // notification
  const listRef = useRef(null);

  return (
    <div className="rootWindow">

      {/* notification panel */}
      <DynamicList ref={listRef} style={{
        position: 'fixed', bottom: '6px', right: '6px', zIndex: 1000, display: 'flex', flexDirection: 'column', alignItems: 'flex-end',
      }} />

      {/* left panel */}
      <div className="noSqueeze" style={{ display: "flex", flexDirection: "column", width, background: "#DFD" }}>
        <div><button onClick={() => { listRef.current.add_comp(Notification, { closable: true, message: "bruh bruh" }); }}>Make random notification</button></div>
        <div><button onClick={() => { setContent(<PageInstanceCreation refreshInstances={refreshInstances} listRef={listRef} />); }}>New Instance</button></div>
        <div><button onClick={() => { refreshInstances(); }}>Refresh Instance</button></div>

        <div style={{ height: "5px" }} />
        {instanceList.map((e, i) => {
          return <div key={i} style={{ display: "flex", flex: "0 1 auto" }}>
            <button style={{ display: "flex", flex: "1 1 auto" }} onClick={() => { setContent(<InstanceDetail inst_name={e} />) }}>{e}</button>
          </div>;
        })}
      </div>

      {/* middle resizer */}
      <div ref={resizerRef} onMouseDown={onMouseDown} style={{ width: "3px", minWidth: "3px", cursor: "ew-resize" }} />

      {/* right content */}
      <div className="expand" style={{ background: "#DFD" }}>
        {content}
      </div>
    </div>
  );
}




const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <App />
);







