import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { api, Formulation, Ingredient, Line, Me, Product, Summary, Targets } from '../api';
import { Dialog, DialogHead, Empty, fmtDate, fmtDateTime, Heading, Loading, money, num, Tag, toNum, useAction, useApi, useApp } from '../ui';

type Nut = Me['nutrients'];

// ------------------------------------------------------------------ shared pieces
export function nutStatus(v: number | null | undefined, t?: { min?: number | null; max?: number | null }) {
  if (v == null) return 'No full analysis';
  if (t?.min != null && v < t.min) return 'Below minimum';
  if (t?.max != null && v > t.max) return 'Above maximum';
  return t && (t.min != null || t.max != null) ? 'Within target' : 'No target entered';
}

export function SummaryBlock({ summary, targets, nutrients, batch }: { summary: Summary; targets?: Targets; nutrients: Nut; batch?: number | string }) {
  const s = summary || ({} as Summary);
  const statusClass = (value: number | null | undefined, target?: Targets[string]) => {
    const status = nutStatus(value, target);
    if (status === 'Within target') return 'analysis-status analysis-status-ok';
    if (status === 'Below minimum' || status === 'Above maximum') return 'analysis-status analysis-status-out';
    return 'analysis-status analysis-status-neutral';
  };
  return (
    <>
      <div className="row wrap" style={{ gap: 8, margin: '8px 0' }}>
        {batch != null && <span className="pill">Batch {num(batch)} kg</span>}
        <span className="pill">Recipe total {num(s.total_kg, 2)} kg</span>
        <span className="pill">{s.cost_per_kg == null ? 'Cost incomplete' : `${money(s.cost_per_kg)} / kg`}</span>
        {s.cost != null && <span className="pill">{money(s.cost)} per batch</span>}
      </div>
      <div className="sectionlabel analysis-title">Nutrient Analysis</div>
      <div className="tablewrap analysis-table-wrap"><table className="analysis-table">
        <thead><tr><th>Nutrient</th><th>Min</th><th>Supplied</th><th>Max</th><th>Unit</th><th>Status</th></tr></thead>
        <tbody>{nutrients.map((n) => {
        const v = s.nutrients?.[n.key];
        const t = targets?.[n.key];
        return (
          <tr key={n.key}>
            <td className="analysis-nutrient">{n.label}</td>
            <td className="analysis-number">{t?.min == null ? '-' : num(t.min)}</td>
            <td className="analysis-number analysis-supplied">{v == null ? '-' : num(v)}</td>
            <td className="analysis-number">{t?.max == null ? '-' : num(t.max)}</td>
            <td className="analysis-unit">{n.unit || '-'}</td>
            <td><span className={statusClass(v, t)}>{nutStatus(v, t)}</span></td>
          </tr>);
        })}</tbody>
      </table></div>
      {!!s.warnings?.length && <div className="notice"><b>Review flags:</b> {s.warnings.join(' ')}</div>}
    </>
  );
}

// ------------------------------------------------------------------ lists
export function Formulations() {
  const { openDetail, openEditor, canWrite } = useApp();
  const [status, setStatus] = useState('all');
  const { data, error, loading } = useApi<Formulation[]>('/api/formulations');
  const rows = (data || []).filter((f) => status === 'all' || f.status === status);
  return (
    <>
      <Heading eyebrow="Recipes" title="Formulations" sub="Every recipe version is kept. Approved versions cannot be edited; create a new version instead.">
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status">
          <option value="all">All statuses</option>
          {['draft', 'pending', 'approved', 'rejected', 'superseded'].map((s) => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}
        </select>
        <button className="btn btn-primary" disabled={!canWrite} onClick={() => openEditor(null)}>＋ New formulation</button>
      </Heading>
      <section className="card">
        <Loading error={error} loading={loading && !data} />
        <div className="tablewrap"><table>
          <thead><tr><th>Product</th><th>Type</th><th>Version</th><th>Animal / use</th><th>Batch</th><th>Cost / kg</th><th>Status</th><th>Created</th><th></th></tr></thead>
          <tbody>{rows.map((f) => (
            <tr key={f.id}>
              <td className="strong">{f.product_name}</td><td>{f.kind === 'premix' ? 'Premix' : 'Finished feed'}</td><td>v{f.version}</td>
              <td>{f.animal || '—'}</td><td>{num(f.batch_size_kg)} kg</td><td>{f.summary?.cost_per_kg == null ? '—' : money(f.summary.cost_per_kg)}</td>
              <td><Tag status={f.status} /></td><td>{fmtDate(f.created_at)}</td>
              <td><button className="btn btn-light btn-small" onClick={() => openDetail(f.id)}>Open</button></td>
            </tr>))}</tbody>
        </table></div>
        {!loading && !rows.length && <Empty>No recipe versions match.</Empty>}
      </section>
    </>
  );
}

export function Approvals() {
  const { me, openDetail } = useApp();
  const { data, error, loading } = useApi<Formulation[]>('/api/formulations?status=pending');
  const [review, setReview] = useState<{ f: Formulation; approve: boolean } | null>(null);
  const canReview = me.role === 'admin' || me.role === 'nutritionist';
  return (
    <>
      <Heading eyebrow="Review" title="Approvals" sub="A nutritionist or administrator approves or returns each submitted recipe version." />
      <Loading error={error} loading={loading && !data} />
      {(data || []).map((f) => (
        <article className="card" key={f.id}>
          <div className="cardhead"><div><h2>{f.product_name} · Version {f.version}</h2>
            <div className="sub">{f.animal} · {num(f.batch_size_kg)} kg · submitted {fmtDateTime(f.submitted_at)}</div></div><Tag status={f.status} /></div>
          <DetailSummary id={f.id} />
          <div className="row wrap" style={{ marginTop: 12 }}>
            <button className="btn btn-light btn-small" onClick={() => openDetail(f.id)}>Review full recipe</button>
            {canReview && <><button className="btn btn-primary btn-small" onClick={() => setReview({ f, approve: true })}>Approve version</button>
              <button className="btn btn-danger btn-small" onClick={() => setReview({ f, approve: false })}>Return for changes</button></>}
          </div>
        </article>))}
      {!loading && !(data || []).length && <section className="card"><Empty>No recipes are waiting for approval.</Empty></section>}
      <ReviewDialog item={review} onClose={() => setReview(null)} />
    </>
  );
}

function DetailSummary({ id }: { id: string }) {
  const { me } = useApp();
  const { data } = useApi<Formulation>(`/api/formulations/${id}`);
  return data ? <SummaryBlock summary={data.summary} targets={data.targets} nutrients={me.nutrients} /> : null;
}

export function ReviewDialog({ item, onClose, after }: { item: { f: Formulation; approve: boolean } | null; onClose: () => void; after?: () => void }) {
  const { busy, run } = useAction();
  const [note, setNote] = useState('');
  useEffect(() => setNote(''), [item]);
  const flags = item?.f.summary?.warnings?.length || 0;
  const needNote = !item?.approve || flags > 0;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!item) return;
    const r = await run(() => api(`/api/formulations/${item.f.id}/${item.approve ? 'approve' : 'return'}`, 'POST', { note }),
      item.approve ? 'Recipe version approved' : 'Recipe returned for changes');
    if (r) { onClose(); after?.(); }
  };
  return (
    <Dialog open={!!item} onClose={onClose}>
      {item && (
        <form onSubmit={submit}>
          <DialogHead title={item.approve ? 'Approve recipe version' : 'Return for changes'} sub={`${item.f.product_name} · v${item.f.version}`} onClose={onClose} />
          {item.approve && flags > 0 && <div className="notice">This recipe has {flags} review flag{flags > 1 ? 's' : ''} (missing values, target misses or a batch mismatch): {item.f.summary.warnings.join(' ')} Record your nutritionist review note to approve it anyway.</div>}
          <div className="field"><label>{item.approve ? `REVIEW NOTE${needNote ? '' : ' (OPTIONAL)'}` : 'REASON FOR RETURNING'}</label>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} required={needNote} autoFocus /></div>
          <div className="row wrap" style={{ justifyContent: 'flex-end', marginTop: 14 }}>
            <button type="button" className="btn btn-light" onClick={onClose}>Cancel</button>
            <button className={`btn ${item.approve ? 'btn-primary' : 'btn-danger'}`} disabled={busy}>{item.approve ? 'Approve' : 'Return'}</button>
          </div>
        </form>)}
    </Dialog>
  );
}

// ------------------------------------------------------------------ detail
export function RecipeDetail({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { me, canWrite, openEditor, openBatch, tick } = useApp();
  const [f, setF] = useState<Formulation | null>(null);
  const [err, setErr] = useState('');
  const [review, setReview] = useState<{ f: Formulation; approve: boolean } | null>(null);
  const { busy, run } = useAction();
  const reload = () => id && api<Formulation>(`/api/formulations/${id}`).then(setF).catch((e) => setErr(e.message));
  useEffect(() => { setF(null); setErr(''); reload(); /* eslint-disable-next-line */ }, [id, tick]);
  const canReview = me.role === 'admin' || me.role === 'nutritionist';
  const total = Number(f?.summary?.total_kg) || 0;

  const revise = async () => {
    const nf = await run(() => api<Formulation>(`/api/formulations/${f!.id}/revise`, 'POST'), 'New draft version created');
    if (nf) { onClose(); openEditor(nf.id); }
  };
  return (
    <Dialog open={!!id} onClose={onClose} wide>
      {id && (
        <div>
          <DialogHead title={f ? f.product_name : 'Recipe'} onClose={onClose}
            sub={f && <>{f.kind === 'premix' ? 'Premix recipe' : 'Finished feed'} · version {f.version} · {f.animal} · {num(f.batch_size_kg)} kg · <Tag status={f.status} /></>} />
          {err && <div className="notice">{err}</div>}
          {f && <>
            <p className="muted">{f.notes || 'No version notes.'}</p>
            <div className="sectionlabel">Recipe weigh sheet</div>
            <div className="tablewrap"><table style={{ minWidth: 380 }}>
              <thead><tr><th>Ingredient / premix</th><th>Quantity (kg)</th><th>% of batch</th><th>Limits %</th></tr></thead>
              <tbody>{(f.lines || []).map((l: Line, i) => (
                <tr key={i}><td>{l.name}{l.ref_type === 'premix' && <span className="muted"> · premix v{l.snapshot?.premix_version}</span>}</td>
                  <td>{num(l.quantity_kg, 4)}</td><td>{total ? num((l.quantity_kg / total) * 100, 2) : '—'}</td>
                  <td>{l.min_pct != null || l.max_pct != null ? `${l.min_pct ?? 0} – ${l.max_pct ?? 100}` : '—'}</td></tr>))}</tbody>
            </table></div>
            <SummaryBlock summary={f.summary} targets={f.targets} nutrients={me.nutrients} batch={f.batch_size_kg} />
            <div className="footnote">Created {fmtDateTime(f.created_at)} by {f.created_by_email || 'staff'}
              {f.submitted_at && <> · submitted {fmtDateTime(f.submitted_at)} by {f.submitted_by_email}</>}
              {f.reviewed_at && <> · reviewed {fmtDateTime(f.reviewed_at)} by {f.reviewed_by_email}</>}
              {f.review_note && <> · review note: {f.review_note}</>}</div>
            <div className="row wrap hideprint" style={{ marginTop: 13 }}>
              {f.status === 'draft' && <>
                <button className="btn btn-light btn-small" disabled={!canWrite} onClick={() => { onClose(); openEditor(f.id); }}>Edit draft</button>
                <button className="btn btn-primary btn-small" disabled={!canWrite || busy}
                  onClick={() => run(() => api(`/api/formulations/${f.id}/submit`, 'POST'), 'Sent for nutritionist approval')}>Submit for approval</button></>}
              {f.status === 'pending' && canReview && <>
                <button className="btn btn-primary btn-small" onClick={() => setReview({ f, approve: true })}>Approve version</button>
                <button className="btn btn-danger btn-small" onClick={() => setReview({ f, approve: false })}>Return for changes</button></>}
              {f.status === 'approved' && <button className="btn btn-primary btn-small" disabled={!canWrite} onClick={() => { onClose(); openBatch(f.id); }}>Prepare production batch</button>}
              {['approved', 'rejected', 'superseded'].includes(f.status) && <button className="btn btn-light btn-small" disabled={!canWrite || busy} onClick={revise}>Create next version</button>}
              <button className="btn btn-light btn-small" onClick={() => window.print()}>Print / PDF</button>
            </div></>}
          <ReviewDialog item={review} onClose={() => setReview(null)} after={() => { reload(); }} />
        </div>)}
    </Dialog>
  );
}

// ------------------------------------------------------------------ editor
type EdLine = { key: string; ref: string; qty: string; min: string; max: string };
type EdState = { productId: string; animal: string; batch: string; notes: string; targets: Record<string, { min: string; max: string }>; lines: EdLine[]; onlyListed: boolean };
const DRAFT_KEY = 'choiceNutrition.editorDraft.v2';
let seq = 0;
const blankLine = (): EdLine => ({ key: `l${++seq}`, ref: '', qty: '', min: '', max: '' });
const blank = (): EdState => ({ productId: '', animal: '', batch: '100', notes: '', targets: {}, lines: [blankLine()], onlyListed: false });

const toTargets = (t: EdState['targets']): Targets => {
  const out: Targets = {};
  for (const [k, v] of Object.entries(t)) { const min = toNum(v.min), max = toNum(v.max); if (min != null || max != null) out[k] = { min, max }; }
  return out;
};
const apiLines = (lines: EdLine[], keepZero = false) =>
  lines.filter((l) => l.ref && (keepZero || (toNum(l.qty) ?? 0) > 0)).map((l) => {
    const [ref_type, ref_id] = l.ref.split(':');
    return { ref_type, ref_id, quantity_kg: toNum(l.qty) ?? 0, min_pct: toNum(l.min), max_pct: toNum(l.max) };
  });

export function RecipeEditor({ sourceId, open, onClose }: { sourceId: string | null | undefined; open: boolean; onClose: () => void }) {
  const { me, notify, openDetail } = useApp();
  const { busy, run } = useAction();
  const [st, setSt] = useState<EdState>(blank);
  const [ready, setReady] = useState(false);
  const [calc, setCalc] = useState<Summary | null>(null);
  const [opt, setOpt] = useState<any>(null);
  const [optBusy, setOptBusy] = useState(false);
  const [ings, setIngs] = useState<Ingredient[]>([]);
  const [prods, setProds] = useState<Product[]>([]);
  const [premixes, setPremixes] = useState<Formulation[]>([]);
  const editingId = sourceId || null;

  // load reference data + the draft being edited (or the locally saved unsent draft)
  useEffect(() => {
    if (!open) { setReady(false); return; }
    let live = true;
    setOpt(null); setCalc(null);
    (async () => {
      try {
        const [i, p, f] = await Promise.all([api<Ingredient[]>('/api/ingredients'), api<Product[]>('/api/products'), api<Formulation[]>('/api/formulations?status=approved')]);
        if (!live) return;
        setIngs(i.filter((x) => x.active)); setProds(p.filter((x) => x.active)); setPremixes(f.filter((x) => x.kind === 'premix'));
        if (editingId) {
          const d = await api<Formulation>(`/api/formulations/${editingId}`);
          if (!live) return;
          const tg: EdState['targets'] = {};
          for (const [k, v] of Object.entries(d.targets || {})) tg[k] = { min: v.min == null ? '' : String(v.min), max: v.max == null ? '' : String(v.max) };
          setSt({ productId: d.product_id, animal: d.animal || '', batch: String(Number(d.batch_size_kg)), notes: d.notes || '', targets: tg, onlyListed: false,
            lines: (d.lines || []).map((l) => ({ key: `l${++seq}`, ref: `${l.ref_type}:${l.ref_id}`, qty: String(l.quantity_kg), min: l.min_pct == null ? '' : String(l.min_pct), max: l.max_pct == null ? '' : String(l.max_pct) })) });
        } else {
          let saved: EdState | null = null;
          try { saved = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null'); } catch { /* ignore */ }
          setSt(saved && Array.isArray(saved.lines) ? { ...blank(), ...saved } : blank());
        }
        setReady(true);
      } catch (e: any) { notify(e.message); onClose(); }
    })();
    return () => { live = false; };
    // eslint-disable-next-line
  }, [open, editingId]);

  // keep an offline-safe copy of an unsent new recipe
  useEffect(() => {
    if (!open || !ready || editingId) return;
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify(st)); } catch { /* storage unavailable */ }
  }, [st, open, ready, editingId]);

  const product = prods.find((p) => p.id === st.productId);
  const kind = product?.kind || 'premix';
  const materials = useMemo(() => [
    ...ings.map((i) => ({ ref: `ingredient:${i.id}`, name: i.name })),
    ...(kind === 'finished_feed' ? premixes.map((f) => ({ ref: `premix:${f.product_id}`, name: `${f.product_name} · premix` })) : []),
  ], [ings, premixes, kind]);

  // live calculation from the server (same maths used when saving)
  const timer = useRef<number>(0);
  useEffect(() => {
    if (!open || !ready) return;
    window.clearTimeout(timer.current);
    const batch = toNum(st.batch);
    if (!batch || batch <= 0 || !product) { setCalc(null); return; }
    timer.current = window.setTimeout(() => {
      api<Summary>('/api/calculate', 'POST', { kind, batch_size_kg: batch, targets: toTargets(st.targets), lines: apiLines(st.lines, true) })
        .then(setCalc).catch(() => setCalc(null));
    }, 300);
    return () => window.clearTimeout(timer.current);
  }, [st, open, ready, product, kind]);

  const set = (patch: Partial<EdState>) => setSt((s) => ({ ...s, ...patch }));
  const setLine = (key: string, patch: Partial<EdLine>) => setSt((s) => ({ ...s, lines: s.lines.map((l) => (l.key === key ? { ...l, ...patch } : l)) }));
  const pickProduct = (id: string) => {
    const p = prods.find((x) => x.id === id);
    const tg: EdState['targets'] = {};
    for (const [k, v] of Object.entries(p?.targets || {})) tg[k] = { min: v.min == null ? '' : String(v.min), max: v.max == null ? '' : String(v.max) };
    set({ productId: id, targets: tg, animal: st.animal || p?.animal || '' });
  };

  const limitProblem = () => {
    for (const l of st.lines) {
      const lo = toNum(l.min), hi = toNum(l.max);
      if ((lo != null && (lo < 0 || lo > 100)) || (hi != null && (hi < 0 || hi > 100))) return 'Inclusion limits must be between 0 and 100%.';
      if (lo != null && hi != null && lo > hi) return 'An ingredient minimum is higher than its maximum.';
    }
    for (const [k, v] of Object.entries(st.targets)) {
      const a = toNum(v.min), b = toNum(v.max);
      if (a != null && b != null && a > b) return `${k}: target minimum is higher than maximum.`;
      if (!['me', 'de', 'ca_p_ratio'].includes(k) && ((a != null && a > 100) || (b != null && b > 100))) return `${k}: percentage targets cannot exceed 100%.`;
    }
    return '';
  };

  const optimize = async () => {
    const batch = toNum(st.batch);
    const p = limitProblem();
    if (p) return notify(p);
    if (!batch || batch <= 0) return notify('Enter a positive batch size first.');
    if (!product) return notify('Choose a product first.');
    setOptBusy(true);
    try {
      const r = await api<any>('/api/optimize', 'POST', { kind, batch_size_kg: batch, targets: toTargets(st.targets), lines: apiLines(st.lines, true), only_listed: st.onlyListed });
      setOpt(r);
      if (r.status === 'optimal') {
        const limited = st.lines.filter((l) => l.ref && (l.min || l.max));
        const out: EdLine[] = r.lines.map((x: any) => {
          const prev = st.lines.find((l) => l.ref === `${x.ref_type}:${x.ref_id}`);
          return { key: `l${++seq}`, ref: `${x.ref_type}:${x.ref_id}`, qty: String(x.quantity_kg), min: prev?.min || '', max: prev?.max || '' };
        });
        for (const l of limited) if (!out.some((o) => o.ref === l.ref)) out.push({ ...l, key: `l${++seq}`, qty: '' });   // keep limits on unused items
        set({ lines: out });
        notify(`Least-cost proposal: ${money(r.cost)} per batch. Review every value before saving.`);
      }
    } catch (e: any) { notify(e.message); } finally { setOptBusy(false); }
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const p = limitProblem();
    if (p) return notify(p);
    const lines = apiLines(st.lines);
    if (!st.productId) return notify('Choose a product.');
    if (!lines.length) return notify('Add at least one ingredient and quantity.');
    const body = { animal: st.animal || null, batch_size_kg: toNum(st.batch), notes: st.notes || null, targets: toTargets(st.targets), lines };
    const r = await run(() => (editingId ? api<Formulation>(`/api/formulations/${editingId}`, 'PUT', body) : api<Formulation>('/api/formulations', 'POST', { ...body, product_id: st.productId })),
      'Draft saved');
    if (r) { try { localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ } onClose(); openDetail(r.id); }
  };

  const total = apiLines(st.lines).reduce((s, l) => s + l.quantity_kg, 0);
  return (
    <Dialog open={open} onClose={onClose} wide>
      {open && (!ready ? <Empty>Loading…</Empty> :
        <form onSubmit={save}>
          <DialogHead title={editingId ? 'Edit draft version' : 'New formulation version'} sub="Select a product and build a recipe for a defined batch." onClose={onClose} />
          <div className="formgrid">
            <div className="field" style={{ gridColumn: 'span 2' }}><label>PRODUCT</label>
              <select value={st.productId} disabled={!!editingId} required onChange={(e) => pickProduct(e.target.value)}>
                <option value="">Choose product…</option>
                {prods.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.kind === 'premix' ? 'Premix' : 'Finished feed'}</option>)}</select></div>
            <div className="field"><label>BATCH SIZE (KG)</label><input type="number" min="0.001" step="any" required value={st.batch} onChange={(e) => set({ batch: e.target.value })} /></div>
            <div className="field"><label>ANIMAL / USE</label><input required value={st.animal} onChange={(e) => set({ animal: e.target.value })} placeholder="e.g. Layer grower" /></div>
            <div className="field" style={{ gridColumn: 'span 2' }}><label>VERSION NOTES</label><input value={st.notes} onChange={(e) => set({ notes: e.target.value })} placeholder="Reason for recipe change" /></div>
          </div>
          <div className="sectionlabel">Nutrient targets · min / max</div>
          <div className="formgrid">{me.nutrients.map((n) => (
            <div className="field" key={n.key}><label>{n.label.toUpperCase()} ({n.unit})</label>
              <div className="row">{(['min', 'max'] as const).map((b) => (
                <input key={b} type="number" step="any" min="0" placeholder={b === 'min' ? 'Min' : 'Max'} value={st.targets[n.key]?.[b] ?? ''}
                  onChange={(e) => set({ targets: { ...st.targets, [n.key]: { min: st.targets[n.key]?.min ?? '', max: st.targets[n.key]?.max ?? '', [b]: e.target.value } } })} />))}</div></div>))}</div>

          <div className="sectionlabel">Recipe ingredients, quantities and inclusion limits</div>
          {st.lines.length > 0 && <div className="formline formhead"><span>Ingredient</span><span>Qty (kg)</span><span title="Minimum inclusion, % of batch">Min %</span><span title="Maximum inclusion, % of batch">Max %</span><span /></div>}
          {st.lines.map((l) => (
            <div className="formline" key={l.key}>
              <select value={l.ref} onChange={(e) => setLine(l.key, { ref: e.target.value })} aria-label="Ingredient">
                <option value="">Choose {kind === 'premix' ? 'ingredient' : 'ingredient or approved premix'}…</option>
                {materials.map((m) => <option key={m.ref} value={m.ref}>{m.name}</option>)}</select>
              <input type="number" min="0" step="any" placeholder="kg" value={l.qty} onChange={(e) => setLine(l.key, { qty: e.target.value })} aria-label="Quantity kg" />
              <input type="number" min="0" max="100" step="any" placeholder="%" value={l.min} onChange={(e) => setLine(l.key, { min: e.target.value })} aria-label="Minimum percent" />
              <input type="number" min="0" max="100" step="any" placeholder="%" value={l.max} onChange={(e) => setLine(l.key, { max: e.target.value })} aria-label="Maximum percent" />
              <button type="button" className="btn btn-light btn-small" aria-label="Remove line" onClick={() => set({ lines: st.lines.filter((x) => x.key !== l.key) })}>×</button>
            </div>))}
          <div className="row wrap" style={{ marginTop: 9 }}>
            <button type="button" className="btn btn-light btn-small" onClick={() => set({ lines: [...st.lines, blankLine()] })}>＋ Add ingredient</button>
            <button type="button" className="btn btn-light btn-small" disabled={optBusy} onClick={optimize}>{optBusy ? 'Optimizing…' : 'Find least-cost mix'}</button>
            <label className="checkline"><input type="checkbox" checked={st.onlyListed} onChange={(e) => set({ onlyListed: e.target.checked })} /> Only use listed ingredients</label>
          </div>
          <div className="footnote">The optimizer (SciPy HiGHS) uses saved prices and analyses. Each material may be 0–100% of the batch unless you enter Min % / Max % limits on its line. Materials with no price, or no value for a targeted nutrient, are left out. Nutritionist review is required.</div>

          {opt && opt.status !== 'optimal' && (
            <div className="notice"><b>{opt.message}</b>
              {!!opt.warnings?.length && <ul style={{ margin: '6px 0 0 16px', padding: 0 }}>{opt.warnings.map((warning: string, i: number) => <li key={i}>{warning}</li>)}</ul>}
              {opt.achievable && <ul style={{ margin: '6px 0 0 16px', padding: 0 }}>{Object.values<any>(opt.achievable).map((a) => <li key={a.label}>{a.label}: the limits allow {num(a.lowest)} to {num(a.highest)}</li>)}</ul>}
              {!!opt.excluded?.length && <div>Left out: {opt.excluded.map((x: any) => `${x.name} (${x.reason})`).join('; ')}</div>}</div>)}
          {opt?.status === 'optimal' && (
            <div className="notice" style={{ background: '#eef6ea', borderColor: '#d3e6cb', color: '#33563a' }}>
              Optimizer: {money(opt.cost)} per batch ({money(opt.cost_per_kg)} / kg).
              {!!opt.binding?.length && <> Limiting: {opt.binding.map((b: any) => (b.label ? `${b.label} ${b.side}` : `${b.ingredient} ${b.side} inclusion`)).join(', ')}.</>}
              {!!opt.excluded?.length && <> {opt.excluded.length} catalogue item{opt.excluded.length > 1 ? 's' : ''} left out for a missing price or nutrient value (see Reports → Data gaps).</>}</div>)}

          <div className="result">
            <div className="resulttop"><span>Estimated recipe summary</span><span>{calc?.cost_per_kg == null ? 'Cost incomplete' : `${money(calc.cost_per_kg)} / kg`}</span></div>
            <div className="sub">Recipe total: {num(total, 3)} kg · stated batch: {num(toNum(st.batch))} kg</div>
            {calc && <div style={{ marginTop: 9 }}><SummaryBlock summary={calc} targets={toTargets(st.targets)} nutrients={me.nutrients} /></div>}
          </div>
          <div className="row wrap" style={{ justifyContent: 'flex-end', marginTop: 14 }}>
            <button className="btn btn-light" type="button" onClick={onClose}>Close</button>
            <button className="btn btn-primary" disabled={busy}>Save draft version</button>
          </div>
        </form>)}
    </Dialog>
  );
}
