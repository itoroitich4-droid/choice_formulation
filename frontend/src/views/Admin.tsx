import { FormEvent, useState } from 'react';
import { api, download, Role } from '../api';
import { Empty, fmtDateTime, Heading, Loading, useAction, useApi, useApp } from '../ui';

export function History() {
  const { me, notify } = useApp();
  const ev = useApi<any[]>('/api/events?limit=150');
  const canBackup = me.role === 'admin' || me.role === 'nutritionist';
  return (
    <>
      <Heading eyebrow="Records and recovery" title="History & backup" sub="View recorded changes and download a workspace backup.">
        <button className="btn btn-primary" disabled={!canBackup} onClick={() => download('/api/backup', 'backup.json').then(() => notify('Backup downloaded')).catch((e) => notify(e.message))}>Export backup</button>
      </Heading>
      <section className="card">
        <div className="cardhead"><div><h2>Workspace history</h2><div className="sub">Recipe, approval and production events with who did them.</div></div></div>
        <Loading error={ev.error} loading={ev.loading && !ev.data} />
        {(ev.data || []).map((e) => (
          <div className="historyitem" key={e.id}><strong>{String(e.event).replaceAll('_', ' ')}{e.details?.name ? ` · ${e.details.name}` : ''}{e.details?.version ? ` v${e.details.version}` : ''}</strong>
            <small>{fmtDateTime(e.at)} · {e.actor_email || 'staff'}</small></div>))}
        {!ev.loading && !(ev.data || []).length && <Empty>Changes will be listed here as recipes and batches are saved.</Empty>}
      </section>
      <div className="notice">Backups are JSON snapshots for review or migration. The database itself should also have scheduled backups (Supabase daily backups or point-in-time recovery) and a tested restore process.</div>
      {me.role === 'admin' && <Team />}
    </>
  );
}

function Team() {
  const { me, notify } = useApp();
  const { data, error } = useApi<any[]>('/api/members');
  const { busy, run } = useAction();
  const add = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const form = e.currentTarget;
    const r = await run(() => api('/api/members', 'POST', { user_id: String(f.get('user_id')).trim(), email: String(f.get('email')).trim() || null, role: String(f.get('role')) }), 'Member saved');
    if (r) form.reset();
  };
  return (
    <section className="card">
      <div className="cardhead"><div><h2>Team access</h2><div className="sub">Invite staff in Supabase Authentication, then add their user ID here with a role.</div></div></div>
      <Loading error={error} />
      <div className="tablewrap"><table>
        <thead><tr><th>Email</th><th>User ID</th><th>Role</th><th>Active</th></tr></thead>
        <tbody>{(data || []).map((m) => (
          <tr key={m.user_id}><td className="strong">{m.email || '—'}</td><td className="muted" style={{ fontSize: 10 }}>{m.user_id}</td>
            <td><select value={m.role} disabled={busy || m.user_id === me.user_id} onChange={(e) => run(() => api(`/api/members/${m.user_id}`, 'PATCH', { role: e.target.value as Role }), 'Role updated')}>
              {['admin', 'nutritionist', 'formulator', 'viewer'].map((r) => <option key={r}>{r}</option>)}</select></td>
            <td><button className="btn btn-light btn-small" disabled={busy || m.user_id === me.user_id} onClick={() => run(() => api(`/api/members/${m.user_id}`, 'PATCH', { active: !m.active }), 'Updated').catch(() => notify('Failed'))}>{m.active ? 'Deactivate' : 'Activate'}</button></td></tr>))}</tbody>
      </table></div>
      <form onSubmit={add} className="row wrap" style={{ marginTop: 12 }}>
        <input name="user_id" required placeholder="User ID (UUID)" style={{ flex: '2 1 240px' }} /><input name="email" type="email" placeholder="Email" style={{ flex: '1 1 160px' }} />
        <select name="role" defaultValue="formulator">{['admin', 'nutritionist', 'formulator', 'viewer'].map((r) => <option key={r}>{r}</option>)}</select>
        <button className="btn btn-primary btn-small" disabled={busy}>Add member</button>
      </form>
    </section>
  );
}
