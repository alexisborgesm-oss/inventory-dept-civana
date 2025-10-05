// src/pages/MonthlyInventory.tsx
import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '../utils/supabase'; // <-- import RELATIVO (ajústalo si tu ruta difiere)

/* ========= Helpers sin dayjs ========= */
function getMonthLabel(m: number) {
  const labels = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
  return labels[(m - 1 + 12) % 12];
}
function getCurrentMonth() { return new Date().getMonth() + 1; } // 1..12
function getCurrentYear()  { return new Date().getFullYear(); }
function pickExistingKey<T extends object>(row: T | undefined, candidates: string[], fallback: string) {
  if (!row) return fallback;
  const hit = candidates.find(k => Object.prototype.hasOwnProperty.call(row, k));
  return (hit ?? fallback) as keyof T as string;
}
// Elige la fecha efectiva del record (inventory_date o, si no hay, created_at)
function effectiveRecordDate(rec: { inventory_date?: string | null; created_at?: string | null }) {
  return new Date(rec.inventory_date ?? rec.created_at ?? '1970-01-01T00:00:00Z').getTime();
}

/* ========= Tipos ========= */
type UserRole = 'super_admin' | 'admin' | 'standard';
type User = { id: string; role: UserRole; department_id: number | null };

type Department = { id: number; name: string };
type Category   = { id: number; name: string };
type Item = {
  id: number; name: string; category_id: number;
  item_number?: string | null; article_number?: string | null;
};

type AnyRow = Record<string, any>;

type MonthlyRow = {
  category_id: number;
  category_name: string;
  item_id: number;
  item_name: string;
  item_number?: string | null;
  qty_current_total: number;
  qty_prev_total: number;
  diff: number;
  notes: string;
};

/* ========= Config rápida ========= */
const TABLE_DEPTS = 'departments';
const TABLE_CATS  = 'categories';
const TABLE_ITEMS = 'items';
const TABLE_MI    = 'monthly_inventories';

// Primero intenta la vista, si no existe usa la tabla
const AREA_ITEMS_SOURCES = [
  { table: 'area_items_view', qtyCandidates: ['qty_current','qty','quantity'] },
  { table: 'area_items',      qtyCandidates: ['qty_current','qty','quantity'] },
];

// Campos de area_items/_view
const AREA_ITEMS_FIELDS = {
  dept: 'department_id',
  area: 'area_id',
  item: 'item_id',
  cat:  'category_id',
  item_number: ['item_number', 'article_number'] // usa el primero que exista
};

const MonthlyInventory: React.FC<{ user: User }> = ({ user }) => {
  const [departmentId, setDepartmentId] = useState<number | ''>(
    user.role === 'super_admin' ? '' : (user.department_id ?? '')
  );
  const [month, setMonth] = useState<number>(getCurrentMonth());
  const [year,  setYear]  = useState<number>(getCurrentYear());

  const [departments, setDepartments] = useState<Department[]>([]);
  const [categories,  setCategories]  = useState<Category[]>([]);
  const [items,       setItems]       = useState<Item[]>([]);

  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<MonthlyRow[]>([]);
  const [showPast, setShowPast] = useState(false);
  const [pastCount, setPastCount] = useState(3); // 1..11
  const [pastTable, setPastTable] = useState<
    { category_id: number; category_name: string; item_id: number; item_name: string; item_number?: string | null;
      current_qty: number; history: { label: string; qty: number }[]; grouped_notes: string }[]
  >([]);

  const allNotesOk = useMemo(
    () => rows.every(r => (r.diff === 0 ? true : r.notes.trim().length > 0)),
    [rows]
  );

  useEffect(() => {
    (async () => {
      const [d, c, i] = await Promise.all([
        supabase.from(TABLE_DEPTS).select('id,name'),
        supabase.from(TABLE_CATS).select('id,name'),
        supabase.from(TABLE_ITEMS).select('id,name,category_id,item_number,article_number')
      ]);
      if (!d.error && d.data) setDepartments(d.data as Department[]);
      if (!c.error && c.data) setCategories(c.data as Category[]);
      if (!i.error && i.data) setItems(i.data as Item[]);
    })();
  }, []);

  const nameOfCategory = (id: number) => categories.find(c => c.id === id)?.name ?? '—';
  const nameOfItem     = (id: number) => items.find(i => i.id === id)?.name ?? `Item ${id}`;
  const itemNumberOf   = (id: number) => {
    const it = items.find(i => i.id === id);
    return (it?.item_number ?? it?.article_number ?? null) || null;
  };
async function loadCurrentTotals() {
  const deptId = user.role === 'super_admin' ? Number(departmentId) : Number(user.department_id);
  if (!deptId) { alert('Selecciona un departamento.'); return; }

  setLoading(true);
  setShowPast(false);
  setPastTable([]);

  try {
    // 1) Catálogos mínimos para cruzar (áreas del depto, items y categorías si no están)
    const [areasRes, itemsRes, catsRes] = await Promise.all([
  supabase.from('areas').select('id, department_id').eq('department_id', deptId),
  items.length ? Promise.resolve({ data: items, error: null }) : supabase.from('items').select('id,item as name,category_id,article_number'),
  categories.length ? Promise.resolve({ data: categories, error: null }) : supabase.from('categories').select('id,name'),
]);

    if (areasRes.error) throw areasRes.error;
    if ('error' in itemsRes && itemsRes.error) throw itemsRes.error;
    if ('error' in catsRes && catsRes.error) throw catsRes.error;

    if (!items.length && itemsRes.data) setItems(itemsRes.data as Item[]);
    if (!categories.length && catsRes.data) setCategories(catsRes.data as Category[]);

    const areaIds = (areasRes.data ?? []).map((a: any) => Number(a.id));
    if (areaIds.length === 0) {
      setRows([]);
      return;
    }

    // 2) Para cada área, trae su último record (1 consulta por área — nº de áreas normalmente pequeño)
    const recPromises = areaIds.map(areaId =>
      supabase.from('records')
        .select('id, area_id, inventory_date, created_at')
        .eq('area_id', areaId)
        .order('inventory_date', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false, nullsFirst: false })
        .limit(1)
    );
    const recResults = await Promise.all(recPromises);

    const latestRecords = recResults
      .map(r => (r.error || !r.data || r.data.length === 0) ? null : r.data[0])
      .filter(Boolean) as { id:number; area_id:number; inventory_date?:string|null; created_at?:string|null }[];

    if (latestRecords.length === 0) {
      setRows([]); // No hay registros todavía
      return;
    }

    // 3) Trae sus items y suma qty por item
    const recordIds = latestRecords.map(r => r.id);
    const riRes = await supabase
      .from('record_items')
      .select('record_id,item_id,qty');
    if (riRes.error) throw riRes.error;

    // Filtra solo los items de los records "últimos" por área
    const riRows = (riRes.data ?? []).filter((r: any) => recordIds.includes(Number(r.record_id)));

    // detecta nombre real de la columna de cantidad (por si fuera numeric vs int)
    const qtyField = pickExistingKey(riRows[0], ['qty', 'quantity', 'qty_current'], 'qty');

    const byItem = new Map<number, number>(); // item_id -> total qty
    riRows.forEach((r: any) => {
      const itemId = Number(r.item_id);
      const q = Number(r[qtyField] ?? 0);
      byItem.set(itemId, (byItem.get(itemId) ?? 0) + q);
    });

    // 4) Mes anterior inmediato (para Qty Previous)
    const prevM = month === 1 ? 12 : month - 1;
    const prevY = month === 1 ? year - 1 : year;

    const prevRes = await supabase
      .from('monthly_inventories')
      .select('item_id, qty_total')
      .eq('department_id', deptId)
      .eq('month', prevM)
      .eq('year', prevY);

    const prevMap = new Map<number, number>();
    if (!prevRes.error && prevRes.data) {
      for (const r of prevRes.data as any[]) prevMap.set(Number(r.item_id), Number(r.qty_total ?? 0));
    }

    // 5) Armar filas con nombre/categoría y article_number
    const catName = (id: number) => categories.find(c => c.id === id)?.name ?? '—';

    const built: MonthlyRow[] = Array.from(byItem.entries()).map(([item_id, qty]) => {
      const it = items.find(i => i.id === item_id);
      const category_id = it?.category_id ?? 0;
      const prev = prevMap.get(item_id) ?? 0;
      return {
        category_id,
        category_name: catName(category_id),
        item_id,
        item_name: it?.name ?? `Item ${item_id}`,
        item_number: it?.item_number ?? it?.article_number ?? null, // en tu esquema existe article_number
        qty_current_total: qty,
        qty_prev_total: prev,
        diff: qty - prev,
        notes: ''
      };
    });

    built.sort((a,b) =>
      a.category_name.localeCompare(b.category_name) || a.item_name.localeCompare(b.item_name)
    );

    setRows(built);
  } catch (e: any) {
    console.error(e);
    alert('Error cargando totales actuales. Revisa que existan y tengan datos las tablas "areas", "records" y "record_items".');
  } finally {
    setLoading(false);
  }
}


  

  async function saveMonthly() {
    if (!allNotesOk) return;
    const deptId = user.role === 'super_admin' ? Number(departmentId) : Number(user.department_id);
    if (!deptId) { alert('Selecciona un departamento.'); return; }

    setLoading(true);
    try {
      const payload = rows.map(r => ({
        department_id: deptId,
        month, year,
        category_id: r.category_id,
        item_id: r.item_id,
        item_number: r.item_number ?? null,
        qty_total: r.qty_current_total,
        notes: r.notes.trim(),
        created_by: user.id
      }));

      const up = await supabase
        .from(TABLE_MI)
        .upsert(payload, { onConflict: 'department_id,month,year,item_id', ignoreDuplicates: false })
        .select('id');

      if (up.error) throw up.error;
      alert('Monthly Inventory guardado correctamente.');
    } catch (e:any) {
      console.error(e);
      alert('Error guardando Monthly Inventory.');
    } finally {
      setLoading(false);
    }
  }

  async function loadPast() {
    const deptId = user.role === 'super_admin' ? Number(departmentId) : Number(user.department_id);
    if (!deptId) { alert('Selecciona un departamento.'); return; }
    if (pastCount < 1 || pastCount > 11) { alert('El valor permitido es 1..11'); return; }

    setLoading(true);
    try {
      // N meses anteriores a la selección actual
      const labels: {month:number; year:number; label:string}[] = [];
      let m = month, y = year;
      for (let i=0; i<pastCount; i++) {
        m = m === 1 ? 12 : m - 1;
        if (m === 12) y = y - 1;
        labels.push({ month: m, year: y, label: `${getMonthLabel(m)}-${String(y).slice(-2)}` });
      }

      const fetches = labels.map(l =>
        supabase.from(TABLE_MI)
          .select('category_id,item_id,item_number,qty_total,notes')
          .eq('department_id', deptId)
          .eq('month', l.month)
          .eq('year', l.year)
      );
      const resAll = await Promise.all(fetches);

      const byItem = new Map<number, { cat:number; item:number; item_number?:string|null; ser:{idx:number; qty:number; note:string}[] }>();
      resAll.forEach((res, idx) => {
        if (res.error || !res.data) return;
        for (const r of res.data as AnyRow[]) {
          const it = Number(r.item_id);
          if (!byItem.has(it)) byItem.set(it, { cat:Number(r.category_id), item:it, item_number:r.item_number ?? null, ser: [] });
          byItem.get(it)!.ser.push({ idx, qty:Number(r.qty_total ?? 0), note:String(r.notes ?? '').trim() });
        }
      });

      const table = Array.from(byItem.values()).map(v => {
        const rn = rows.find(r => r.item_id === v.item);
        const current_qty = rn?.qty_current_total ?? 0;
        const history = labels.map((l, pos) => {
          const hit = v.ser.find(s => s.idx === pos);
          return { label: l.label, qty: hit ? hit.qty : 0 };
        });
        const grouped_notes = labels.map((l,pos) => {
          const hit = v.ser.find(s => s.idx === pos);
          return hit && hit.note ? `${l.label}: ${hit.note}` : '';
        }).filter(Boolean).join(', ');

        return {
          category_id: v.cat,
          category_name: nameOfCategory(v.cat),
          item_id: v.item,
          item_name: nameOfItem(v.item),
          item_number: v.item_number ?? itemNumberOf(v.item),
          current_qty,
          history,
          grouped_notes
        };
      });

      table.sort((a,b) =>
        a.category_name.localeCompare(b.category_name) || a.item_name.localeCompare(b.item_name)
      );

      setPastTable(table);
      setShowPast(true);
    } catch (e:any) {
      console.error(e);
      alert('Error cargando inventarios pasados.');
    } finally {
      setLoading(false);
    }
  }

  const grouped = useMemo(() => {
    const by = new Map<number, { name:string; rows: MonthlyRow[]; now:number; prev:number }>();
    rows.forEach(r => {
      if (!by.has(r.category_id)) by.set(r.category_id, { name:r.category_name, rows:[], now:0, prev:0 });
      const g = by.get(r.category_id)!;
      g.rows.push(r);
      g.now  += r.qty_current_total;
      g.prev += r.qty_prev_total;
    });
    return Array.from(by.entries()).map(([category_id, v]) => ({
      category_id, category_name: v.name, rows: v.rows, totalDiff: v.now - v.prev
    }));
  }, [rows]);

  const rowBg = (diff:number, current:number) => {
    if (diff < 0)   return '#ffe5e5';   // rojo
    if (diff === 0) return '#e8f5e9';   // verde
    if (diff === current) return '#e3f2fd'; // azul (prev=0)
    return '#fff3e0';                    // naranja
  };

  return (
    <div className="p-4 max-w-[1200px] mx-auto">
      <h1 className="text-2xl font-semibold mb-4">Monthly Inventory</h1>

      <div className="flex flex-wrap items-end gap-3 mb-4">
        {user.role === 'super_admin' && (
          <div className="flex flex-col">
            <label className="text-sm font-medium mb-1">Department</label>
            <select
              className="border rounded px-3 py-2 min-w-[240px]"
              value={departmentId}
              onChange={e => setDepartmentId(e.target.value ? Number(e.target.value) : '')}
            >
              <option value="">Select...</option>
              {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
        )}

        <div className="flex flex-col">
          <label className="text-sm font-medium mb-1">Month</label>
          <select className="border rounded px-3 py-2" value={month} onChange={e=>setMonth(Number(e.target.value))}>
            {Array.from({length:12},(_,i)=>i+1).map(m => (
              <option key={m} value={m}>{getMonthLabel(m)}</option>
            ))}
          </select>
        </div>

        <div className="flex flex-col">
          <label className="text-sm font-medium mb-1">Year</label>
          <input type="number" className="border rounded px-3 py-2 w-[120px]" value={year}
                 onChange={e => setYear(Number(e.target.value))}/>
        </div>

        <button className="px-4 py-2 rounded bg-gray-800 text-white disabled:opacity-50"
                disabled={loading || (user.role === 'super_admin' && !departmentId)}
                onClick={loadCurrentTotals}>
          Load current totals
        </button>
      </div>

      {/* Tabla principal */}
      <div className="border rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-3 py-2 text-left">Category / Item</th>
                <th className="px-3 py-2 text-left">Item Number</th>
                <th className="px-3 py-2 text-right">Qty (Current)</th>
                <th className="px-3 py-2 text-right">Qty (Previous)</th>
                <th className="px-3 py-2 text-right">Δ (Item)</th>
                <th className="px-3 py-2 text-right">Δ (Category Total)</th>
                <th className="px-3 py-2 text-left">Notes</th>
              </tr>
            </thead>
            <tbody>
              {grouped.map(group => (
                <React.Fragment key={group.category_id}>
                  <tr className="bg-gray-100 font-medium">
                    <td className="px-3 py-2">{group.category_name}</td>
                    <td className="px-3 py-2"></td>
                    <td className="px-3 py-2 text-right">
                      {group.rows.reduce((a,b)=>a+b.qty_current_total,0)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {group.rows.reduce((a,b)=>a+b.qty_prev_total,0)}
                    </td>
                    <td className="px-3 py-2 text-right">—</td>
                    <td className="px-3 py-2 text-right">
                      {(() => {
                        const now  = group.rows.reduce((a,b)=>a+b.qty_current_total,0);
                        const prev = group.rows.reduce((a,b)=>a+b.qty_prev_total,0);
                        const d = now - prev;
                        return d > 0 ? `+${d}` : d;
                      })()}
                    </td>
                    <td className="px-3 py-2">—</td>
                  </tr>

                  {group.rows.map(r => (
                    <tr key={r.item_id} style={{ background: rowBg(r.diff, r.qty_current_total) }}>
                      <td className="px-3 py-2">{r.item_name}</td>
                      <td className="px-3 py-2">{r.item_number ?? ''}</td>
                      <td className="px-3 py-2 text-right">{r.qty_current_total}</td>
                      <td className="px-3 py-2 text-right">{r.qty_prev_total}</td>
                      <td className="px-3 py-2 text-right">{r.diff > 0 ? `+${r.diff}` : r.diff}</td>
                      <td className="px-3 py-2 text-right">—</td>
                      <td className="px-3 py-2">
                        <input
                          className="border rounded px-2 py-1 w-full"
                          placeholder={r.diff !== 0 ? 'Required (diff ≠ 0)' : '—'}
                          disabled={r.diff === 0}
                          value={r.notes}
                          onChange={(e) => {
                            const v = e.target.value;
                            setRows(prev => prev.map(x => x.item_id === r.item_id ? { ...x, notes: v } : x));
                          }}
                        />
                      </td>
                    </tr>
                  ))}
                </React.Fragment>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={7} className="px-3 py-6 text-center text-gray-500">
                  Carga los totales actuales para comenzar.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Acciones */}
      <div className="flex flex-wrap items-center gap-3 mt-4">
        <button
          className="px-4 py-2 rounded bg-blue-600 text-white disabled:opacity-50"
          disabled={loading || rows.length === 0 || !allNotesOk}
          onClick={saveMonthly}
          title={!allNotesOk ? 'Completa todas las notas con diff ≠ 0' : 'Guardar Monthly Inventory'}
        >
          Save Monthly Inventory
        </button>

        <div className="flex items-center gap-2">
          <label className="text-sm">Show last</label>
          <input type="number" min={1} max={11} value={pastCount}
                 onChange={e => setPastCount(Math.max(1, Math.min(11, Number(e.target.value))))}
                 className="border rounded px-2 py-1 w-[70px]"/>
          <span className="text-sm">inventories</span>
        </div>

        <button
          className="px-4 py-2 rounded bg-gray-700 text-white disabled:opacity-50"
          disabled={loading || rows.length === 0}
          onClick={loadPast}
        >
          Past Inventories
        </button>
      </div>

      {/* Tabla secundaria */}
      {showPast && (
        <div className="mt-6 border rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-left">Category / Item</th>
                  <th className="px-3 py-2 text-left">Item Number</th>
                  <th className="px-3 py-2 text-right">Qty (Current)</th>
                  {pastTable[0]?.history.map((h, i) => (
                    <th key={i} className="px-3 py-2 text-right">Qty ({h.label})</th>
                  ))}
                  <th className="px-3 py-2 text-left">Grouped Notes</th>
                </tr>
              </thead>
              <tbody>
                {(() => {
                  const by = new Map<string, typeof pastTable>();
                  pastTable.forEach(r => {
                    const key = `${r.category_id}|${r.category_name}`;
                    if (!by.has(key)) by.set(key, []);
                    by.get(key)!.push(r);
                  });

                  const chunks: React.ReactNode[] = [];
                  Array.from(by.entries())
                    .sort((a,b)=> a[0].split('|')[1].localeCompare(b[0].split('|')[1]))
                    .forEach(([key, arr]) => {
                      const [,catName] = key.split('|');
                      chunks.push(
                        <tr key={`cat-${key}`} className="bg-gray-100 font-medium">
                          <td className="px-3 py-2">{catName}</td>
                          <td className="px-3 py-2"></td>
                          <td className="px-3 py-2 text-right">
                            {arr.reduce((s,x)=>s+x.current_qty,0)}
                          </td>
                          {arr[0]?.history.map((_,i)=>(
                            <td key={i} className="px-3 py-2 text-right">
                              {arr.reduce((s,x)=> s + (x.history[i]?.qty ?? 0), 0)}
                            </td>
                          ))}
                          <td className="px-3 py-2">—</td>
                        </tr>
                      );
                      arr.sort((a,b)=>a.item_name.localeCompare(b.item_name))
                         .forEach(r => {
                           chunks.push(
                             <tr key={`it-${key}-${r.item_id}`}>
                               <td className="px-3 py-2">{r.item_name}</td>
                               <td className="px-3 py-2">{r.item_number ?? ''}</td>
                               <td className="px-3 py-2 text-right">{r.current_qty}</td>
                               {r.history.map((h,i)=>
                                 <td key={i} className="px-3 py-2 text-right">{h.qty}</td>
                               )}
                               <td className="px-3 py-2">{r.grouped_notes || '—'}</td>
                             </tr>
                           );
                         });
                    });

                  if (chunks.length === 0) {
                    return (
                      <tr>
                        <td colSpan={3 + (pastTable[0]?.history.length ?? 0) + 1}
                            className="px-3 py-6 text-center text-gray-500">
                          No hay inventarios pasados para mostrar.
                        </td>
                      </tr>
                    );
                  }
                  return chunks;
                })()}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

export default MonthlyInventory;
