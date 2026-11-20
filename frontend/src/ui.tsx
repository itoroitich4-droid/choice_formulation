import { createContext, ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { api, Me } from './api';

export const money = (v: unknown) => {
  const n = Number(v);
  return v == null || v === '' || !Number.isFinite(n) ? '—' : 'KSh ' + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};
export const num = (v: unknown, max = 3) => {
  const n = Number(v);
  return v == null || v === '' || !Number.isFinite(n) ? '—' : n.toLocaleString(undefined, { maximumFractionDigits: max });
};
export const fmtDate = (s?: string | null) => (s ? new Date(s).toLocaleDateString() : '—');
export const fmtDateTime = (s?: string | null) => (s ? new Date(s).toLocaleString() : '—');
export const toNum = (s: string): number | null => (s.trim() === '' || !Number.isFinite(+s) ? null : +s);

export const STATUS_LABEL: Record<string, string> = {
  draft: 'Draft', pending: 'Awaiting approval', approved: 'Approved', rejected: 'Returned', superseded: 'Superseded',
};
export const Tag = ({ status }: { status?: string | null }) =>
  status ? <span className={`tag ${status}`}>{STATUS_LABEL[status] || status}</span> : <span className="tag draft">No recipe</span>;

// ------------------------------------------------------------------ app context
type Ctx = {
  me: Me;
  notify: (t: string) => void;
  tick: number;
  refresh: () => void;
  go: (view: string) => void;
  openEditor: (sourceId?: string | null) => void;
  openDetail: (id: string) => void;
  openBatch: (formulationId?: string | null) => void;
  canWrite: boolean;
  canSpec: boolean;
};
export const AppCtx = createContext<Ctx>(null as unknown as Ctx);
export const useApp = () => useContext(AppCtx);

export function useApi<T>(path: string | null, deps: unknown[] = []) {
  const { tick } = useApp();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!path) return;
    let live = true;
    setLoading(true);
    api<T>(path).then((d) => { if (live) { setData(d); setError(''); } })
      .catch((e) => live && setError(e.message)).finally(() => live && setLoading(false));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, tick, ...deps]);
  return { data, error, loading };
}

// ------------------------------------------------------------------ primitives
export function Dialog({ open, onClose, children, wide }: { open: boolean; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} onClose={onClose} style={wide ? { width: 'min(780px, calc(100% - 24px))' } : undefined}>
      {open && children}
    </dialog>
  );
}

export const DialogHead = ({ title, sub, onClose }: { title: ReactNode; sub?: ReactNode; onClose: () => void }) => (
  <div className="dialoghead">
    <div><h2>{title}</h2>{sub && <div className="sub">{sub}</div>}</div>
    <button className="dialogclose hideprint" type="button" onClick={onClose} aria-label="Close">×</button>
  </div>
);

export const Empty = ({ children }: { children: ReactNode }) => <div className="empty">{children}</div>;
export const Loading = ({ error, loading }: { error?: string; loading?: boolean }) =>
  error ? <div className="notice">{error}</div> : loading ? <Empty>Loading…</Empty> : null;

export function Heading({ eyebrow, title, sub, children }: { eyebrow: string; title: string; sub: string; children?: ReactNode }) {
  return (
    <div className="heading">
      <div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1><p>{sub}</p></div>
      <div className="row wrap hideprint">{children}</div>
    </div>
  );
}

export function useToast() {
  const [text, setText] = useState('');
  const t = useRef<number>(0);
  const notify = useCallback((m: string) => {
    setText(m);
    window.clearTimeout(t.current);
    t.current = window.setTimeout(() => setText(''), 3200);
  }, []);
  return { text, notify };
}

export function useAction() {
  const { notify, refresh } = useApp();
  const [busy, setBusy] = useState(false);
  const run = async <T,>(fn: () => Promise<T>, ok?: string): Promise<T | undefined> => {
    setBusy(true);
    try {
      const r = await fn();
      if (ok) notify(ok);
      refresh();
      return r;
    } catch (e: any) {
      notify(e.message || 'Something went wrong');
    } finally { setBusy(false); }
  };
  return { busy, run };
}
