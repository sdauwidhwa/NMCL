import { useEffect, useState, useRef, useImperativeHandle, forwardRef } from 'react';

// Component for single selection with multi-filter and scrolling
export const CompSingleSelectionScrolledFiltered = ({ style, content_style, onSelect, options }) => {

  const { candidates, filter_options, initial_filter_options } = options;
  const [selected_item, set_selected_item] = useState(null);
  const [selected_filters, set_selected_filters] = useState(initial_filter_options);

  useEffect(() => {
    set_selected_filters(initial_filter_options);
  }, [options]);

  // Filter candidates based on selected_filter
  const filtered_candidates = selected_filters.length > 0
    ? candidates.filter(candidate => selected_filters.includes(candidate.type))
    : candidates;





  return (
    <div style={style}>
      <div>
        Selected {selected_item}
      </div>
      <div>
        Filters:
        {filter_options.map(e => {
          const onClick = () => { set_selected_filters((prev) => prev.includes(e) ? prev.filter((i) => i !== e) : [...prev, e]); }
          const selected = selected_filters.includes(e)
          return <button key={e} style={{ backgroundColor: selected ? "#acb7ceff" : null }} onClick={onClick}>{e}</button>;
        })}
      </div>

      <div style={content_style}>
        {filtered_candidates.map(e2 => {
          const e = e2.id;
          const onClick = () => { set_selected_item(e); onSelect(e); }
          const selected = selected_item === e;
          return <button key={e} style={{ backgroundColor: selected ? "#acb7ceff" : null }} onClick={onClick}>{e}</button>;
        })}
      </div>


    </div >
  );
};





export const DynamicList = forwardRef((props, ref) => {
  const [comps, setComps] = useState([]);
  const [next_key] = useState({ value: 0 });

  const add_comp = (func, child_props) => {
    const key = next_key.value++;
    setComps(prev => [...prev, { key, func, props: child_props }]);
    return key;
  };

  const remove_comp = (key) => {
    setComps(prev => prev.filter(c => c.key !== key));
  };

  // New method to update a specific component
  const update_comp = (key, newProps) => {
    setComps(prev => prev.map(c =>
      c.key === key ? { ...c, props: { ...c.props, ...newProps } } : c
    ));
  };

  useImperativeHandle(ref, () => ({
    add_comp,
    remove_comp,
    update_comp,
  }));

  return (
    <div {...props}>
      {comps.map(({ key, func: Comp, props }) => (
        <Comp key={key} dlkey={key} dlparent={ref} {...props} />
      ))}
    </div>
  );
});



export function ExampleApp() {
  const listRef = useRef();

  return (
    <div>
      <button onClick={() => {
        const new_comp = listRef.current.add_comp(SampleComponent, { text: Date.now(), progress: 0 });
        // Update progress every 100ms
        let progress = 0;
        const interval = setInterval(() => {
          progress += 3.33; // 100% over 3000ms
          if (progress >= 100) {
            progress = 100;
            clearInterval(interval);
          }
          listRef.current.update_comp(new_comp, { progress });
        }, 100);

        setTimeout(() => { listRef.current.remove_comp(new_comp); }, 3000);
      }}>
        Add from Sibling
      </button>


      <DynamicList ref={listRef} />
    </div>
  );
}

function SampleComponent({ text, dlkey, dlparent, progress = 0 }) {
  return (
    <div className="p-2 bg-green-200 rounded mb-2">
      <div className="flex items-center justify-between">
        <span>{`${text} key=${dlkey}`}</span>
        <button
          onClick={() => dlparent.current.remove_comp(dlkey)}
          className="ml-2 px-2 py-1 bg-red-500 text-white rounded"
        >
          X
        </button>
      </div>

      {/* Progress Bar */}
      <div className="w-full bg-gray-200 rounded-full h-2.5 mt-2">
        <div
          className="bg-blue-600 h-2.5 rounded-full transition-all duration-100"
          style={{ width: `${progress}%` }}
        ></div>
      </div>

      <div className="text-xs text-gray-600 mt-1">{progress.toFixed(0)}%</div>
    </div>
  );
}


export const Notification = ({ id, message, type = 'info', onClose }) => {
  useEffect(() => {
    const timer = setTimeout(() => {
      onClose(id);
    }, 15 * 1000);
    return () => clearTimeout(timer);
  }, [id, onClose]);

  const styles = {
    padding: '5px 5px',
    borderRadius: '3px',
    marginBottom: '5px',
    backgroundColor: type === 'error' ? '#e74c3c' : '#2ecc71',
    color: 'white',
    boxShadow: '0px 2px 6px rgba(0,0,0,0.3)',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    minWidth: '250px',
  };

  return (
    <div style={styles}>
      <span>{message}</span>
      <button
        onClick={() => onClose(id)}
        style={{
          marginLeft: '10px',
          background: 'transparent',
          border: 'none',
          color: 'white',
          cursor: 'pointer',
          fontWeight: 'bold',
        }}
      >
        ×
      </button>
    </div>
  );
};





