import type { Session } from '@supabase/supabase-js';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { api, ApiError, Me } from './api';
import { supabase, supabaseConfigured } from './supabase';
import { AppCtx, useToast } from './ui';
import { History } from './views/Admin';
import { Ingredients, Products } from './views/Catalog';
import { BatchDialog, Production } from './views/Production';
import { Approvals, Formulations, RecipeDetail, RecipeEditor } from './views/Recipes';
import { Overview, Reports } from './views/Reports';

const NAV: [string, string, string][] = [
  ['overview', '⌂', 'Overview'], ['products', '▦', 'Products'], ['ingredients', '◇', 'Ingredients'],
  ['formulations', '▥', 'Formulations'], ['approvals', '✓', 'Approvals'], ['production', '⚙', 'Production'],
  ['reports', '▤', 'Dashboard & reports'], ['history', '↺', 'History & backup'],
];

function Gate({ children }: { children: React.ReactNode }) {
  return (
    <div className="accessGate"><section className="gatecard">
      <div className="gatebrand"><div className="logo">C</div><div><strong>Choice Nutrition</strong><div className="eyebrow">Staff workspace</div></div></div>
      {children}
    </section></div>
  );
}

function SignIn({ recovery }: { recovery: boolean }) {
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true); setMsg('');
    if (recovery) {
      const pw = String(f.get('password')), pw2 = String(f.get('confirm'));
      if (pw !== pw2) { setBusy(false); return setMsg('Passwords do not match.'); }
      const { error } = await supabase.auth.updateUser({ password: pw });
      setMsg(error ? error.message : 'Password updated. You can continue.');
      if (!error) window.location.hash = '';
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email: String(f.get('email')).trim(), password: String(f.get('password')) });
      if (error) setMsg(error.message);
    }
    setBusy(false);
  };
  const reset = async (form: HTMLFormElement | null) => {
    const email = String(new FormData(form!).get('email') || '').trim();
    if (!email) return setMsg('Enter your company email first.');
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin });
    setMsg(error ? error.message : 'If that account exists, a reset link has been sent.');
  };
  return (
    <Gate>
      <form onSubmit={submit}>
        <h1>{recovery ? 'Choose a new password' : 'Staff sign in'}</h1>
        <p>{recovery ? 'Set a new password for your staff account.' : 'Use your Choice Nutrition staff account to open the shared workspace.'}</p>
        {!recovery && <div className="field"><label>COMPANY EMAIL</label><input name="email" type="email" autoComplete="username" required /></div>}
        <div className="field" style={{ marginTop: 12 }}><label>{recovery ? 'NEW PASSWORD' : 'PASSWORD'}</label>
          <input name="password" type="password" autoComplete={recovery ? 'new-password' : 'current-password'} minLength={recovery ? 8 : undefined} required /></div>
        {recovery && <div className="field" style={{ marginTop: 12 }}><label>CONFIRM PASSWORD</label><input name="confirm" type="password" autoComplete="new-password" minLength={8} required /></div>}
        <div className="gateMessage" role="status">{msg}</div>
        <div className="gateActions">
          <button className="btn btn-primary" disabled={busy}>{recovery ? 'Update password' : 'Sign in'}</button>
          {!recovery && <button className="btn btn-light" type="button" onClick={(e) => reset((e.currentTarget as HTMLButtonElement).form)}>Forgot password?</button>}
        </div>
      </form>
    </Gate>
  );
}

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [recovery, setRecovery] = useState(false);
  useEffect(() => {
    if (!supabaseConfigured) { setSession(null); return; }
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      if (event === 'PASSWORD_RECOVERY') setRecovery(true);
      if (event === 'SIGNED_OUT') setRecovery(false);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  if (!supabaseConfigured) return (
    <Gate><h1>Workspace not configured</h1>
      <p>Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (see .env.example) and rebuild the app.</p></Gate>);
  if (session === undefined) return <Gate><p>Loading…</p></Gate>;
  if (!session || recovery) return <SignIn recovery={recovery && !!session} />;
  return <Workspace session={session} />;
}

function Workspace({ session }: { session: Session }) {
  const [me, setMe] = useState<Me | null>(null);
  const [denied, setDenied] = useState('');
  const [view, setView] = useState('overview');
  const [menu, setMenu] = useState(false);
  const [tick, setTick] = useState(0);
  const [editor, setEditor] = useState<{ open: boolean; id: string | null }>({ open: false, id: null });
  const [detail, setDetail] = useState<string | null>(null);
  const [batch, setBatch] = useState<{ open: boolean; id: string | null }>({ open: false, id: null });
  const [online, setOnline] = useState(navigator.onLine);
  const toast = useToast();

  useEffect(() => {
    api<Me>('/api/me').then(setMe).catch((e: ApiError) => setDenied(e.status === 403 ? 'denied' : e.message));
  }, [session.user.id]);
  useEffect(() => {
    const on = () => setOnline(true), off = () => setOnline(false);
    window.addEventListener('online', on); window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);
  const refresh = useCallback(() => setTick((t) => t + 1), []);
  const go = useCallback((v: string) => { setView(v); setMenu(false); window.scrollTo(0, 0); }, []);

  if (denied) return (
    <Gate><h1>{denied === 'denied' ? 'Access not set up' : 'Cannot reach the server'}</h1>
      <p>{denied === 'denied' ? 'This account has not been added as an active Choice Nutrition staff member. Ask an administrator to add it.' : denied}</p>
      <button className="btn btn-light" onClick={() => supabase.auth.signOut()}>Sign out</button></Gate>);
  if (!me) return <Gate><p>Loading workspace…</p></Gate>;

  const canWrite = me.role !== 'viewer';
  const canSpec = me.role === 'admin' || me.role === 'nutritionist';
  const ctx = {
    me, notify: toast.notify, tick, refresh, go, canWrite, canSpec,
    openEditor: (id?: string | null) => setEditor({ open: true, id: id || null }),
    openDetail: (id: string) => setDetail(id),
    openBatch: (id?: string | null) => setBatch({ open: true, id: id || null }),
  };
  const title = NAV.find((n) => n[0] === view)?.[2] || '';
  return (
    <AppCtx.Provider value={ctx}>
      <div className="app">
        <aside className={`sidebar ${menu ? 'open' : ''}`}>
          <div className="brand"><div className="logo">C</div><div><strong>Choice Nutrition</strong><span>Feed workspace</span></div></div>
          <nav className="nav">{NAV.map(([id, ico, label]) => (
            <button key={id} className={view === id ? 'active' : ''} onClick={() => go(id)}><span className="ico">{ico}</span>{label}</button>))}</nav>
          <div className="sidebar-foot">Estimates only. Prices, analyses and targets come from company records and nutritionist review.</div>
        </aside>
        <main className="main">
          <header className="topbar">
            <button className="mobile-menu" aria-label="Menu" onClick={() => setMenu(!menu)}>☰</button>
            <div className="crumb">Choice Nutrition / <b>{title}</b></div>
            <span className="status" data-state={online ? 'online' : 'error'}>{online ? '● Connected' : '● Offline'}</span>
            <span className="user"><span className="avatar">{(me.email || '?')[0].toUpperCase()}</span>{me.email} · {me.role}</span>
            <button className="btn btn-light btn-small" onClick={() => supabase.auth.signOut()}>Sign out</button>
          </header>
          <div className="content">
            {!online && <div className="notice">You are offline. Saved data cannot be loaded or changed until the connection returns. An unsent new recipe is kept on this device.</div>}
            {view === 'overview' && <Overview />}{view === 'products' && <Products />}{view === 'ingredients' && <Ingredients />}
            {view === 'formulations' && <Formulations />}{view === 'approvals' && <Approvals />}{view === 'production' && <Production />}
            {view === 'reports' && <Reports />}{view === 'history' && <History />}
          </div>
        </main>
        <RecipeEditor open={editor.open} sourceId={editor.id} onClose={() => { setEditor({ open: false, id: null }); refresh(); }} />
        <RecipeDetail id={detail} onClose={() => setDetail(null)} />
        <BatchDialog open={batch.open} presetId={batch.id} onClose={() => { setBatch({ open: false, id: null }); refresh(); }} />
        <div className={`toast ${toast.text ? 'show' : ''}`} role="status">{toast.text}</div>
      </div>
    </AppCtx.Provider>
  );
}

