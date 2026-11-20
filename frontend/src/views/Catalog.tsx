import { FormEvent, useState } from 'react';
import { api, Ingredient, Product, Targets } from '../api';
import { Dialog, DialogHead, Empty, Heading, Loading, money, num, Tag, toNum, useAction, useApi, useApp } from '../ui';

const CATEGORIES = ['Grain / energy', 'Protein source', 'Mineral', 'Amino acid', 'Vitamin / premix component',
  'Enzyme / additive', 'Oil / fat', 'Other'];

// ------------------------------------------------------------------ products
export function Products() {
  const { me, canWrite, canSpec, notify } = useApp();
  const { data, error, loading } = useApi<Product[]>('/api/products');
  const [filter, setFilter] = useState('all');
  const [edit, setEdit] = useState<Product | 'new' | null>(null);
  const { run } = useAction();
  const rows = (data || []).filter((p) => filter === 'all' || p.kind === filter);
  return (
    <>
      <Heading eyebrow="Catalogue" title="Products" sub="Premixes and finished feeds. Each has its own recipes and versions.">
        <select value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter products">
          <option value="all">All products</option><option value="premix">Premixes</option><option value="finished_feed">Finished feeds</option>
        </select>
        <button className="btn btn-primary" disabled={!canWrite} onClick={() => setEdit('new')}>＋ Add product</button>
      </Heading>
      <section className="card">
        <Loading error={error} loading={loading && !data} />
        <div className="tablewrap"><table>
          <thead><tr><th>Product</th><th>Type</th><th>Animal / use</th><th>Pack</th><th>Latest version</th><th>Status</th><th></th></tr></thead>
          <tbody>{rows.map((p) => (
            <tr key={p.id}>
              <td className="strong">{p.name}{!p.active && <span className="muted"> (archived)</span>}</td>
              <td>{p.kind === 'premix' ? 'Premix' : 'Finished feed'}</td><td>{p.animal || '—'}</td><td>{p.pack || '—'}</td>
              <td>{p.latest_version ? `v${p.latest_version}` : '—'}</td><td><Tag status={p.latest_status} /></td>
              <td className="row">
                <button className="btn btn-light btn-small" disabled={!canSpec} onClick={() => setEdit(p)}>Edit</button>
                <button className="btn btn-light btn-small" disabled={!canSpec}
                  onClick={() => run(() => api(`/api/products/${p.id}/active?active=${!p.active}`, 'POST'), p.active ? 'Archived' : 'Restored')}>
                  {p.active ? 'Archive' : 'Restore'}</button>
              </td>
            </tr>))}</tbody>
        </table></div>
        {!loading && !rows.length && <Empty>No products.</Empty>}
      </section>
      <ProductDialog item={edit} onClose={() => setEdit(null)} nutrients={me.nutrients} notify={notify} />
    </>
  );
}

function ProductDialog({ item, onClose, nutrients, notify }: { item: Product | 'new' | null; onClose: () => void; nutrients: { key: string; label: string; unit: string }[]; notify: (t: string) => void }) {
  const existing = item && item !== 'new' ? item : null;
  const { busy, run } = useAction();
  const { canSpec } = useApp();
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const targets: Targets = {};
    for (const n of nutrients) {
      const min = toNum(String(f.get(`${n.key}_min`) || '')), max = toNum(String(f.get(`${n.key}_max`) || ''));
      if (min != null && max != null && min > max) return notify(`${n.label}: minimum cannot be higher than maximum.`);
      if (min != null || max != null) targets[n.key] = { min, max };
    }
    const body = { name: String(f.get('name')), kind: String(f.get('kind')), animal: String(f.get('animal')) || null,
      pack: String(f.get('pack')) || null, description: String(f.get('description')) || null, targets };
    const r = await run(() => (existing ? api(`/api/products/${existing.id}`, 'PUT', body) : api('/api/products', 'POST', body)), 'Product saved');
    if (r) onClose();
  };
  return (
    <Dialog open={!!item} onClose={onClose}>
      {item && (
        <form onSubmit={submit} key={existing?.id || 'new'}>
          <DialogHead title={existing ? 'Edit product' : 'Add product'} sub="Default nutrient ranges are copied into new recipes." onClose={onClose} />
          <div className="formgrid">
            <div className="field" style={{ gridColumn: 'span 2' }}><label>NAME</label><input name="name" required defaultValue={existing?.name} /></div>
            <div className="field"><label>TYPE</label>
              <select name="kind" defaultValue={existing?.kind || 'premix'} disabled={!!existing && !canSpec}><option value="premix">Premix</option><option value="finished_feed">Finished feed</option></select></div>
            <div className="field"><label>ANIMAL / USE</label><input name="animal" defaultValue={existing?.animal || ''} /></div>
            <div className="field"><label>PACK SIZE</label><input name="pack" defaultValue={existing?.pack || ''} /></div>
            <div className="field"><label>NOTES</label><input name="description" defaultValue={existing?.description || ''} /></div>
          </div>
          <div className="sectionlabel">Default nutrient targets · min / max</div>
          <div className="formgrid">{nutrients.map((n) => (
            <div className="field" key={n.key}><label>{n.label.toUpperCase()} ({n.unit})</label>
              <div className="row"><input name={`${n.key}_min`} type="number" step="any" min="0" placeholder="Min" defaultValue={existing?.targets?.[n.key]?.min ?? ''} disabled={!canSpec} />
                <input name={`${n.key}_max`} type="number" step="any" min="0" placeholder="Max" defaultValue={existing?.targets?.[n.key]?.max ?? ''} disabled={!canSpec} /></div></div>))}</div>
          <div className="row wrap" style={{ justifyContent: 'flex-end', marginTop: 14 }}>
            <button className="btn btn-light" type="button" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" disabled={busy}>Save product</button>
          </div>
        </form>)}
    </Dialog>
  );
}

// ------------------------------------------------------------------ ingredients
export function Ingredients() {
  const { me, canSpec, notify } = useApp();
  const { data, error, loading } = useApi<Ingredient[]>('/api/ingredients');
  const [edit, setEdit] = useState<Ingredient | 'new' | null>(null);
  const { run } = useAction();
  const n = (i: Ingredient, k: string) => (i.nutrients?.[k] == null ? '—' : num(i.nutrients[k]));
  return (
    <>
      <Heading eyebrow="Specifications" title="Ingredients" sub="Cost and nutrient analysis from supplier or laboratory records. Leave unknown values blank.">
        <button className="btn btn-primary" disabled={!canSpec} onClick={() => setEdit('new')}>＋ Add ingredient</button>
      </Heading>
      {!canSpec && <div className="notice">Ingredient specifications are managed by an administrator or nutritionist.</div>}
      <section className="card">
        <Loading error={error} loading={loading && !data} />
        <div className="tablewrap"><table>
          <thead><tr><th>Ingredient</th><th>Category</th><th>Cost / kg</th>{me.nutrients.map((x) => <th key={x.key}>{x.label} ({x.unit})</th>)}<th></th></tr></thead>
          <tbody>{(data || []).map((i) => (
            <tr key={i.id}>
              <td className="strong">{i.name}{!i.active && <span className="muted"> (archived)</span>}<div className="muted" style={{ fontSize: 10 }}>{i.source}</div></td>
              <td>{i.category || '—'}</td><td>{i.cost_per_kg == null ? '—' : money(i.cost_per_kg)}</td>
              {me.nutrients.map((x) => <td key={x.key}>{x.key === 'ca_p_ratio' ? (i.nutrients?.calcium != null && i.nutrients?.phosphorus > 0 ? `${num(i.nutrients.calcium / i.nutrients.phosphorus)}:1` : '—') : n(i, x.key)}</td>)}
              <td className="row">
                <button className="btn btn-light btn-small" disabled={!canSpec} onClick={() => setEdit(i)}>Edit</button>
                <button className="btn btn-light btn-small" disabled={!canSpec}
                  onClick={() => run(() => api(`/api/ingredients/${i.id}/active?active=${!i.active}`, 'POST'), i.active ? 'Archived' : 'Restored')}>
                  {i.active ? 'Archive' : 'Restore'}</button>
              </td>
            </tr>))}</tbody>
        </table></div>
        {!loading && !(data || []).length && <Empty>No ingredients yet.</Empty>}
      </section>
      <IngredientDialog item={edit} onClose={() => setEdit(null)} nutrients={me.nutrients} notify={notify} />
    </>
  );
}

function IngredientDialog({ item, onClose, nutrients, notify }: { item: Ingredient | 'new' | null; onClose: () => void; nutrients: { key: string; label: string; unit: string }[]; notify: (t: string) => void }) {
  const existing = item && item !== 'new' ? item : null;
  const { busy, run } = useAction();
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const nut: Record<string, number> = {};
    for (const n of nutrients) { const v = toNum(String(f.get(n.key) || '')); if (v != null) nut[n.key] = v; }
    const body = { name: String(f.get('name')), category: String(f.get('category')), pack: String(f.get('pack')) || null,
      cost_per_kg: toNum(String(f.get('cost') || '')), source: String(f.get('source')) || null, nutrients: nut };
    if (body.cost_per_kg != null && body.cost_per_kg < 0) return notify('Cost cannot be negative.');
    const r = await run(() => (existing ? api(`/api/ingredients/${existing.id}`, 'PUT', body) : api('/api/ingredients', 'POST', body)), 'Ingredient saved');
    if (r) onClose();
  };
  return (
    <Dialog open={!!item} onClose={onClose}>
      {item && (
        <form onSubmit={submit} key={existing?.id || 'new'}>
          <DialogHead title={existing ? 'Edit ingredient' : 'Add ingredient'} sub="Changing a price or analysis affects new and refreshed recipe drafts. Approved versions keep their own snapshot." onClose={onClose} />
          <div className="formgrid">
            <div className="field" style={{ gridColumn: 'span 2' }}><label>NAME</label><input name="name" required defaultValue={existing?.name} /></div>
            <div className="field"><label>CATEGORY</label><select name="category" defaultValue={existing?.category && CATEGORIES.includes(existing.category) ? existing.category : 'Other'}>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select></div>
            <div className="field"><label>COST PER KG (KSh)</label><input name="cost" type="number" step="any" min="0" defaultValue={existing?.cost_per_kg ?? ''} /></div>
            <div className="field"><label>PACK / SUPPLIER UNIT</label><input name="pack" defaultValue={existing?.pack || ''} /></div>
            <div className="field"><label>DATA SOURCE</label><input name="source" placeholder="Supplier sheet, lab report…" defaultValue={existing?.source || ''} /></div>
          </div>
          <div className="sectionlabel">Nutrient analysis (as fed)</div>
          <div className="formgrid">{nutrients.map((n) => (
            n.key === 'ca_p_ratio' ? <div className="field" key={n.key}><label>{n.label.toUpperCase()} ({n.unit})</label><input value={existing?.nutrients?.calcium != null && existing?.nutrients?.phosphorus ? `${num(existing.nutrients.calcium / existing.nutrients.phosphorus)}:1` : 'Calculated from calcium and total P'} readOnly /></div> :
            <div className="field" key={n.key}><label>{n.label.toUpperCase()} ({n.unit})</label>
              <input name={n.key} type="number" step="any" min="0" defaultValue={existing?.nutrients?.[n.key] ?? ''} /></div>))}</div>
          <div className="row wrap" style={{ justifyContent: 'flex-end', marginTop: 14 }}>
            <button className="btn btn-light" type="button" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" disabled={busy}>Save ingredient</button>
          </div>
        </form>)}
    </Dialog>
  );
}
