import { supabase } from './supabase';

const BASE = ((import.meta.env.VITE_API_URL as string | undefined) || '').replace(/\/$/, '');

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

function detailText(d: any): string {
  if (typeof d === 'string') return d;
  if (Array.isArray(d)) return d.map((e) => `${(e.loc || []).slice(1).join('.') || 'Input'}: ${e.msg}`).join('; ');
  return 'Request failed';
}

async function raw(path: string, init: RequestInit = {}): Promise<Response> {
  const { data } = await supabase.auth.getSession();
  const headers = new Headers(init.headers);
  if (data.session) headers.set('Authorization', `Bearer ${data.session.access_token}`);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  let res: Response;
  try { res = await fetch(BASE + path, { ...init, headers }); }
  catch { throw new ApiError(0, 'Cannot reach the server. Check your connection and try again.'); }
  if (!res.ok) {
    let msg = res.statusText;
    try { msg = detailText((await res.json()).detail); } catch { /* keep status text */ }
    if (res.status === 401) await supabase.auth.signOut();
    throw new ApiError(res.status, msg);
  }
  return res;
}

export async function api<T = any>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const res = await raw(path, { method, body: body === undefined ? undefined : JSON.stringify(body) });
  return (await res.json()) as T;
}

export async function download(path: string, fallbackName: string) {
  const res = await raw(path);
  const blob = await res.blob();
  const cd = res.headers.get('Content-Disposition') || '';
  const name = /filename="?([^"]+)"?/.exec(cd)?.[1] || fallbackName;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

export type Range = { min?: number | null; max?: number | null };
export type Targets = Record<string, Range>;
export type Nutrient = { key: string; label: string; unit: string };
export type Me = { user_id: string; email: string | null; role: Role; nutrients: Nutrient[] };
export type Role = 'admin' | 'nutritionist' | 'formulator' | 'viewer';
export type Ingredient = {
  id: string; name: string; category: string | null; cost_per_kg: string | number | null; pack: string | null;
  source: string | null; nutrients: Record<string, number>; active: boolean;
};
export type Product = {
  id: string; name: string; kind: 'premix' | 'finished_feed'; animal: string | null; pack: string | null;
  description: string | null; targets: Targets; active: boolean; latest_version: number | null; latest_status: string | null;
};
export type Summary = {
  total_kg: number; cost: number | null; cost_per_kg: number | null; nutrients: Record<string, number | null>; warnings: string[];
};
export type Line = {
  ref_type: 'ingredient' | 'premix'; ref_id: string; name: string; quantity_kg: number;
  min_pct: number | null; max_pct: number | null; snapshot?: any;
};
export type Formulation = {
  id: string; product_id: string; product_name: string; version: number; kind: 'premix' | 'finished_feed';
  animal: string | null; batch_size_kg: string | number; status: string; created_at: string; created_by_email: string | null;
  submitted_at: string | null; submitted_by_email?: string | null; reviewed_at: string | null; reviewed_by_email: string | null;
  review_note: string | null; summary: Summary; notes?: string | null; targets?: Targets; lines?: Line[];
};
export type Batch = {
  id: string; formulation_id: string; product_name: string; version: number; batch_count: string | number;
  total_kg: string | number; lot: string | null; produced_on: string; prepared_by: string | null; lines: Line[]; created_at: string;
};
