import { FormEvent, useEffect, useState } from 'react';
import { api, Batch, Formulation } from '../api';
import { Dialog, DialogHead, Empty, fmtDate, Heading, Loading, num, useAction, useApi, useApp } from '../ui';

export function Production() {
  const { canWrite, openBatch } = useApp();
  const { data, error, loading } = useApi<Batch[]>('/api/batches');
  const [sheet, setSheet] = useState<Batch | null>(null);
  return (
    <>
      <Heading eyebrow="Manufacturing" title="Production batches" sub="Generate a scaled batch sheet from an approved recipe version.">
        <button className="btn btn-primary" disabled={!canWrite} onClick={() => openBatch(null)}>＋ Prepare batch</button>
      </Heading>
      <section className="card">
        <Loading error={error} loading={loading && !data} />
        <div className="tablewrap"><table>
          <thead><tr><th>Lot / reference</th><th>Product</th><th>Recipe version</th><th>Quantity</th><th>Date</th><th>Prepared by</th><th></th></tr></thead>
          <tbody>{(data || []).map((b) => (
            <tr key={b.id}><td className="strong">{b.lot || b.id.slice(0, 8)}</td><td>{b.product_name}</td><td>v{b.version}</td>
              <td>{num(b.total_kg)} kg</td><td>{fmtDate(b.produced_on)}</td><td>{b.prepared_by || '—'}</td>
              <td><button className="btn btn-light btn-small" onClick={() => setSheet(b)}>Open sheet</button></td></tr>))}</tbody>
        </table></div>
        {!loading && !(data || []).length && <Empty>No production batches have been prepared.</Empty>}
      </section>
      <BatchSheet batch={sheet} onClose={() => setSheet(null)} />
    </>
  );
}

export function BatchSheet({ batch: b, onClose }: { batch: Batch | null; onClose: () => void }) {
  return (
    <Dialog open={!!b} onClose={onClose} wide>
      {b && <div>
        <DialogHead title={b.product_name} onClose={onClose}
          sub={<>Production batch sheet · {b.lot || b.id.slice(0, 8)} · recipe version {b.version} · {num(b.total_kg)} kg · {fmtDate(b.produced_on)}</>} />
        <div className="row wrap"><span className="pill">Batches: {num(b.batch_count)}</span><span className="pill">Prepared by: {b.prepared_by || '—'}</span></div>
        <div className="sectionlabel">Ingredients to weigh</div>
        <div className="tablewrap"><table style={{ minWidth: 340 }}>
          <thead><tr><th>Ingredient / premix</th><th>Quantity (kg)</th><th>Weighed (kg)</th></tr></thead>
          <tbody>{b.lines.map((l, i) => <tr key={i}><td>{l.name}</td><td>{num(l.quantity_kg, 4)}</td><td style={{ minWidth: 90 }}></td></tr>)}</tbody>
        </table></div>
        <div className="footnote">Verify lot identity, scale calibration, and actual weights during production according to company procedures.</div>
        <div className="row wrap hideprint" style={{ justifyContent: 'flex-end', marginTop: 14 }}>
          <button className="btn btn-light btn-small" onClick={() => window.print()}>Print / PDF</button></div>
      </div>}
    </Dialog>
  );
}

export function BatchDialog({ open, presetId, onClose }: { open: boolean; presetId: string | null | undefined; onClose: () => void }) {
  const { me, notify } = useApp();
  const { busy, run } = useAction();
  const [approved, setApproved] = useState<Formulation[]>([]);
  const [fid, setFid] = useState('');
  const [full, setFull] = useState<Formulation | null>(null);
  const [count, setCount] = useState('1');
  const [lot, setLot] = useState('');
  const [date, setDate] = useState('');
  const [by, setBy] = useState('');

  useEffect(() => {
    if (!open) return;
    const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    setDate(d.toISOString().slice(0, 10)); setCount('1'); setLot(''); setBy(me.email || '');
    api<Formulation[]>('/api/formulations?status=approved').then((r) => {
      setApproved(r);
      if (!r.length) { notify('Approve a formulation version before preparing production.'); onClose(); return; }
      setFid(presetId && r.some((x) => x.id === presetId) ? presetId : r[0].id);
    }).catch((e) => { notify(e.message); onClose(); });
    // eslint-disable-next-line
  }, [open, presetId]);
  useEffect(() => { if (open && fid) api<Formulation>(`/api/formulations/${fid}`).then(setFull).catch(() => setFull(null)); }, [open, fid]);

  const n = Number(count) || 0;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const r = await run(() => api<Batch>('/api/batches', 'POST', { formulation_id: fid, batch_count: n, lot, produced_on: date, prepared_by: by }), 'Production sheet saved');
    if (r) onClose();
  };
  return (
    <Dialog open={open} onClose={onClose}>
      {open && <form onSubmit={submit}>
        <DialogHead title="Prepare production batch" sub="Only approved recipe versions can be produced." onClose={onClose} />
        <div className="formgrid" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <div className="field" style={{ gridColumn: 'span 2' }}><label>APPROVED RECIPE</label>
            <select value={fid} onChange={(e) => setFid(e.target.value)}>{approved.map((f) => <option key={f.id} value={f.id}>{f.product_name} · v{f.version} · {num(f.batch_size_kg)} kg</option>)}</select></div>
          <div className="field"><label>NUMBER OF BATCHES</label><input type="number" min="0.001" step="any" required value={count} onChange={(e) => setCount(e.target.value)} /></div>
          <div className="field"><label>LOT / REFERENCE</label><input value={lot} onChange={(e) => setLot(e.target.value)} /></div>
          <div className="field"><label>PRODUCTION DATE</label><input type="date" required value={date} onChange={(e) => setDate(e.target.value)} /></div>
          <div className="field"><label>PREPARED BY</label><input value={by} onChange={(e) => setBy(e.target.value)} /></div>
        </div>
        {full && <div className="result">
          <div className="resulttop"><span>{full.product_name} · v{full.version}</span><span>Total {num(Number(full.batch_size_kg) * n)} kg</span></div>
          <div className="sectionlabel">Scaled weigh sheet</div>
          {(full.lines || []).map((l, i) => <div className="row" key={i} style={{ justifyContent: 'space-between', padding: '5px 0', borderBottom: '1px solid var(--line)' }}>
            <span>{l.name}</span><b>{num(l.quantity_kg * n, 3)} kg</b></div>)}
        </div>}
        <div className="row wrap" style={{ justifyContent: 'flex-end', marginTop: 14 }}>
          <button type="button" className="btn btn-light" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={busy || !fid || n <= 0}>Save batch sheet</button>
        </div>
      </form>}
    </Dialog>
  );
}
