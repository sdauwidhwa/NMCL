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





export const DynamicList = forwardRef((props, self_ref) => {
  const [comps, set_comps] = useState([]);
  const [next_key] = useState({ value: 0 });

  const add_comp = (func, child_props) => {
    const dlkey = next_key.value++;
    set_comps(prev => [...prev, { dlkey, func, props: child_props }]);
    return dlkey;
  };

  const remove_comp = (dlkey) => {
    set_comps(prev => prev.filter(c => c.dlkey !== dlkey));
  };

  const update_comp = (dlkey, new_props) => {
    set_comps(prev => prev.map(c =>
      c.dlkey === dlkey ? { ...c, props: { ...c.props, ...new_props } } : c
    ));
  };

  useImperativeHandle(self_ref, () => ({
    add_comp,
    remove_comp,
    update_comp,
  }));

  return (
    <div {...props}>
      {comps.map(({ dlkey, func: Comp, props }) => (
        <Comp key={dlkey} dlkey={dlkey} dlparent={self_ref} {...props} />
      ))}
    </div>
  );
});






export const Notification = ({ dlparent, dlkey, closable, close_timeout, on_close, message }) => {
  
  const close_self = () => {
    dlparent.current.remove_comp(dlkey);
    if (on_close) { on_close(); }
  };
  useEffect(() => {
    let timer;
    if (close_timeout) {
      timer = setTimeout(() => {
        close_self();
      }, close_timeout);
    }
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [dlkey, on_close, close_timeout]);

  const styles = {
    display: 'flex',
    padding: '3px 3px',
    marginBottom: '3px',
    backgroundColor: "white",
    boxShadow: '0px 2px 6px rgba(0,0,0,0.3)',
    justifyContent: 'space-between',
    alignItems: 'center',
    minWidth: '250px',
  };

  return (
    <div style={styles}>
      <span>{message}</span>
      {closable && <button onClick={() => close_self()}> X </button>}
    </div>
  );
};





