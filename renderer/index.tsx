import { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';

type Api = Window['ipc_api'];
type Events = Window['ipc_events'];

type TaskState = {
  progress: string | null;
  result: string | null;
  abortFn: (() => void) | null;
};

function LongTaskCard({ title, steps, intervalMs }: { title: string; steps: number; intervalMs: number }) {
  const api: Api | undefined = typeof window !== 'undefined' ? window.ipc_api : undefined;
  const [state, setState] = useState<TaskState>({ progress: null, result: null, abortFn: null });
  const [error, setError] = useState<string | null>(null);

  const start = () => {
    if (!api) return;
    setError(null);
    setState({ progress: null, result: null, abortFn: null });

    const { prom, abort } = api.abortable.fooLongAbortable2(
      { steps, interval: intervalMs },
      msg => setState(prev => ({ ...prev, progress: msg.message }))
    );

    setState(prev => ({ ...prev, abortFn: abort }));

    prom.then(res => {
      setState(prev => ({ ...prev, result: String(res) }));
    }).catch(err => {
      setError(String(err));
    }).finally(() => {
      setState(prev => ({ ...prev, abortFn: null }));
    });
  };

  const abort = () => {
    state.abortFn?.();
  };

  return (
    <section style={{ background: '#eef6ff', padding: '1rem', borderRadius: 8, marginTop: '1rem' }}>
      <h3 style={{ marginTop: 0 }}>{title}</h3>
      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
        <button onClick={start} disabled={Boolean(state.abortFn)}>
          Start
        </button>
        <button onClick={abort} disabled={!state.abortFn}>
          Abort
        </button>
        {state.progress && <span>Progress: {state.progress}</span>}
        {state.result && <span style={{ marginLeft: 'auto', fontWeight: 600 }}>Result: {state.result}</span>}
      </div>
      {error && <div style={{ color: '#c22', marginTop: '0.5rem' }}>{error}</div>}
    </section>
  );
}

function ClockPanel({ events }: { events: Events | undefined }) {
  const [time, setTime] = useState<string | null>(null);

  useEffect(() => {
    if (!events) return;
    const off = events.clock(payload => {
      setTime(new Date(payload.epochMs).toLocaleTimeString());
    });
    return () => {
      off?.();
    };
  }, [events]);

  return (
    <section style={{ background: '#fff4e6', padding: '0.75rem 1rem', borderRadius: 8, marginTop: '1rem', display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
      <strong>Clock event:</strong>
      <span>{time ?? 'waiting...'}</span>
    </section>
  );
}

function App() {
  const api: Api | undefined = typeof window !== 'undefined' ? window.ipc_api : undefined;
  const events: Events | undefined = typeof window !== 'undefined' ? window.ipc_events : undefined;

  const [username, setUsername] = useState('alex');
  const [helloMessage, setHelloMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const helloPayload = useMemo(() => ({ username: username || undefined }), [username]);

  const callHello = async () => {
    if (!api) return;
    setError(null);
    try {
      const res = await api.fooHello(helloPayload);
      setHelloMessage(res.message);
    } catch (err) {
      setError(String(err));
    }
  };

  return (
    <main style={{ fontFamily: 'Inter, ui-sans-serif, system-ui', maxWidth: 900, margin: '2rem auto', lineHeight: 1.5 }}>
      <h1 style={{ marginBottom: '0.5rem' }}>Electron IPC explorer</h1>
      <p>Types and runtime bindings come from the main process registrations.</p>

      <ClockPanel events={events} />

      <section style={{ background: '#f8f9fb', padding: '1rem', borderRadius: 8, marginTop: '1rem' }}>
        <h2 style={{ marginTop: 0 }}>fooHello</h2>
        <label style={{ display: 'block', marginBottom: '0.5rem' }}>
          Username
          <input
            style={{ marginLeft: '0.5rem' }}
            value={username}
            onChange={e => setUsername((e.target as HTMLInputElement).value)}
            placeholder="alex"
          />
        </label>
        <button onClick={callHello}>Call fooHello</button>
        {helloMessage && (
          <pre style={{ marginTop: '0.75rem', padding: '0.75rem', background: '#fff', border: '1px solid #e0e4ea', borderRadius: 6 }}>
            {helloMessage}
          </pre>
        )}
      </section>

      <section style={{ background: '#eaf2ff', padding: '1rem', borderRadius: 8, marginTop: '1rem' }}>
        <h2 style={{ marginTop: 0 }}>fooLongAbortable2 (two concurrent callers)</h2>
        <LongTaskCard title="Task A" steps={5} intervalMs={400} />
        <LongTaskCard title="Task B" steps={8} intervalMs={250} />
      </section>

      {error && <div style={{ color: '#c22', marginTop: '1rem' }}>{error}</div>}
    </main>
  );
}

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(<App />);
}
