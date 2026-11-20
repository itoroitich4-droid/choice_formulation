import { useState } from 'react';
import { download } from '../api';
import { Empty, fmtDate, Heading, Loading, money, num, Tag, useApi, useApp } from '../ui';

type Summary = { approved: number; pending: number; draft: number; kg_30d: number; gaps: number; products: number };

export function Overview() {
  const { openEditor, openDetail, go, canWrite } = useApp();
  const s = useApi<Summary>('/api/reports/summary');
  const f = useApi<any[]>('/api/formulations');
  const b = useApi<any[]>('/api/batches');
  const tile = (label: string, v: number | string | undefined, icon: string) => (
    <div className="stat"><div><div className="stat-label">{label}</div><div className="stat-value">{v ?? '—'}</div></div><div className="stat-icon">{icon}</div></div>);
  return (
    <>
      <Heading eyebrow="Internal feed workspace" title="Formulate with confidence." sub="Manage products, build recipes, review versions, and prepare production batches.">
        <button className="btn btn-primary" disabled={!canWrite} onClick={() => openEditor(null)}>＋ New formulation</button>
      </Heading>
      <Loading error={s.error} />
      <div className="stats">
        {tile('Products', s.data?.products, '▦')}{tile('Draft formulations', s.data?.draft, '✎')}
        {tile('Awaiting approval', s.data?.pending, '⌛')}{tile('Approved recipes', s.data?.approved, '✓')}
      </div>
      <div className="grid">
        <div>
          <section className="card"><div className="cardhead"><div><h2>Recent formulations</h2><div className="sub">Latest recipe versions and review states</div></div>
            <button className="btn btn-light btn-small" onClick={() => go('formulations')}>All formulations</button></div>
            {(f.data || []).slice(0, 6).map((x) => (
              <div className="saveditem" key={x.id}><div className="row wrap" style={{ justifyContent: 'space-between' }}>
                <div><strong>{x.product_name} · v{x.version}</strong><small>{x.kind === 'premix' ? 'Premix recipe' : 'Finished feed'} · {x.animal || 'Use unspecified'} · {fmtDate(x.created_at)}</small></div><Tag status={x.status} /></div>
                <div style={{ marginTop: 8 }}><button className="btn btn-light btn-small" onClick={() => openDetail(x.id)}>Review recipe</button></div></div>))}
            {!f.loading && !(f.data || []).length && <Empty>No formulation versions yet.</Empty>}
          </section>
          <section className="card"><div className="cardhead"><div><h2>Production activity</h2><div className="sub">Recently prepared batch sheets</div></div>
            <button className="btn btn-light btn-small" onClick={() => go('production')}>View batches</button></div>
            {(b.data || []).slice(0, 5).map((x) => <div className="saveditem" key={x.id}><strong>{x.product_name} · {x.lot || 'Batch'}</strong>
              <small>v{x.version} · {num(x.batch_count)} batch(es) · {fmtDate(x.produced_on)}</small></div>)}
            {!b.loading && !(b.data || []).length && <Empty>No production activity yet.</Empty>}
          </section>
        </div>
        <section className="card"><div className="cardhead"><div><h2>Quick start</h2><div className="sub">Start with verified ingredient data.</div></div></div>
          <div className="saveditem"><strong>1. Add ingredients</strong><small>Enter cost and nutrient analysis from a trusted source.</small></div>
          <div className="saveditem"><strong>2. Add products</strong><small>Premixes and finished feeds each have their own recipes.</small></div>
          <div className="saveditem"><strong>3. Formulate and review</strong><small>Submit a version for nutritionist approval before production.</small></div>
          <div className="notice">The app calculates estimates from entered data. It does not decide whether a ration is safe or nutritionally adequate.</div>
        </section>
      </div>
    </>
  );
}

export function Reports() {
  const { me, notify } = useApp();
  const s = useApi<Summary>('/api/reports/summary');
  const r = useApi<any[]>('/api/reports/recipes');
  const gaps = useApi<{ id: string; name: string; missing: string[] }[]>('/api/reports/gaps');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const q = `?${from ? `from=${from}&` : ''}${to ? `to=${to}` : ''}`;
  const b = useApi<any[]>(`/api/reports/batches${q}`, [from, to]);
  const totals: Record<string, number> = {};
  (b.data || []).forEach((x) => { totals[x.product_name] = (totals[x.product_name] || 0) + Number(x.total_kg); });
  const exp = (path: string, name: string) => download(path, name).catch((e) => notify(e.message));
  return (
    <>
      <Heading eyebrow="Management view" title="Dashboard & reports" sub="Recipe status, costs, production output and data gaps. Figures come only from entered data.">
        <button className="btn btn-light" onClick={() => window.print()}>Print / PDF</button>
      </Heading>
      <div className="stats">
        <div className="stat"><div><div className="stat-label">Approved recipes</div><div className="stat-value">{s.data?.approved ?? '—'}</div></div><div className="stat-icon">✓</div></div>
        <div className="stat"><div><div className="stat-label">Awaiting approval</div><div className="stat-value">{s.data?.pending ?? '—'}</div></div><div className="stat-icon">⌛</div></div>
        <div className="stat"><div><div className="stat-label">Produced, last 30 days (kg)</div><div className="stat-value">{s.data ? num(s.data.kg_30d, 1) : '—'}</div></div><div className="stat-icon">⚙</div></div>
        <div className="stat"><div><div className="stat-label">Ingredients missing data</div><div className="stat-value">{s.data?.gaps ?? '—'}</div></div><div className="stat-icon">!</div></div>
      </div>
      <section className="card">
        <div className="cardhead"><div><h2>Recipe report</h2><div className="sub">Latest version of each premix and finished feed</div></div>
          <button className="btn btn-light btn-small hideprint" onClick={() => exp('/api/reports/recipes?format=csv', 'recipe-report.csv')}>Export CSV</button></div>
        <div className="tablewrap"><table>
          <thead><tr><th>Product</th><th>Type</th><th>Version</th><th>Status</th><th>Batch (kg)</th><th>Cost / kg</th>{me.nutrients.map((n) => <th key={n.key}>{n.label} ({n.unit})</th>)}<th>Checks</th></tr></thead>
          <tbody>{(r.data || []).map((x) => (
            <tr key={x.id}><td className="strong">{x.name}</td><td>{x.kind === 'premix' ? 'Premix' : 'Finished feed'}</td><td>{x.version ? `v${x.version}` : '—'}</td>
              <td><Tag status={x.status} /></td><td>{x.version ? num(x.batch_size_kg) : '—'}</td><td>{x.summary?.cost_per_kg == null ? '—' : money(x.summary.cost_per_kg)}</td>
              {me.nutrients.map((n) => <td key={n.key}>{x.summary?.nutrients?.[n.key] == null ? '—' : n.key === 'ca_p_ratio' ? `${num(x.summary.nutrients[n.key])}:1` : num(x.summary.nutrients[n.key])}</td>)}
              <td>{x.version ? (x.summary?.warnings?.length ? <span className="tag rejected">{x.summary.warnings.length} flag{x.summary.warnings.length > 1 ? 's' : ''}</span> : <span className="tag approved">None</span>) : '—'}</td></tr>))}</tbody>
        </table></div>
        {!r.loading && !(r.data || []).length && <Empty>No products yet.</Empty>}
      </section>
      <section className="card">
        <div className="cardhead"><div><h2>Batch report</h2><div className="sub">Production batches by production date</div></div>
          <div className="row wrap hideprint">
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From date" />
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To date" />
            <button className="btn btn-light btn-small" onClick={() => exp(`/api/reports/batches${q}${q.length > 1 ? '&' : ''}format=csv`.replace('?&', '?'), 'batch-report.csv')}>Export CSV</button></div></div>
        <div className="row wrap" style={{ gap: 8, marginBottom: 8 }}>
          {Object.entries(totals).sort((a, c) => c[1] - a[1]).map(([k, v]) => <span className="pill" key={k}><b>{k}</b>: {num(v, 1)} kg</span>)}
          {!!(b.data || []).length && <span className="pill"><b>All products</b>: {num(Object.values(totals).reduce((a, c) => a + c, 0), 1)} kg</span>}</div>
        <div className="tablewrap"><table>
          <thead><tr><th>Date</th><th>Lot / reference</th><th>Product</th><th>Version</th><th>Total (kg)</th><th>Prepared by</th></tr></thead>
          <tbody>{(b.data || []).map((x) => <tr key={x.id}><td>{fmtDate(x.produced_on)}</td><td className="strong">{x.lot || x.id.slice(0, 8)}</td><td>{x.product_name}</td><td>v{x.version}</td><td>{num(x.total_kg)}</td><td>{x.prepared_by || '—'}</td></tr>)}</tbody>
        </table></div>
        {!b.loading && !(b.data || []).length && <Empty>No batches in this date range.</Empty>}
      </section>
      <section className="card">
        <div className="cardhead"><div><h2>Data gaps</h2><div className="sub">Ingredients without a price or a full nutrient analysis</div></div></div>
        {(gaps.data || []).map((g) => <div className="saveditem" key={g.id}><strong>{g.name}</strong><small>Missing: {g.missing.join('; ')}</small></div>)}
        {!gaps.loading && !(gaps.data || []).length && <Empty>All active ingredients have a price and a full nutrient analysis.</Empty>}
      </section>
    </>
  );
}
