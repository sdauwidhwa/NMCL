import { useEffect, useState } from 'react';

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


export const Notification = ({ id, message, type = 'info', onClose }) => {
  useEffect(() => {
    const timer = setTimeout(() => {
      onClose(id);
    }, 3000); // auto close after 3 seconds
    return () => clearTimeout(timer);
  }, [id, onClose]);

  const styles = {
    padding: '10px 20px',
    borderRadius: '5px',
    marginBottom: '10px',
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





 