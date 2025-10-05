// src/pages/MonthlyInventory.tsx
import React, { useEffect, useMemo, useState } from 'react';
// ⬇️ usa UNA de estas dos líneas (deja la que aplique y borra la otra)
// import { supabase } from '@/utils/supabase';
import { supabase } from '../utils/supabase';

type Role = 'super_admin' | 'admin' | 'standard';
type User = { id: string; role: Role; department_id: number | null };

type Category = { id: number; name: string };
type Item = { id: number; name: string; category_id: number; article_number?: string | null };

type MonthlyRow = {
  category_id: number;
  category_name: string;
  item_id: number;
  item_name: string;
  item_number: string | null;
  qty_current_total: number;
  qty_prev_total: number;
  diff: number;
  notes: string;
};

function monthLabel(m: number) {
  return ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'][m-1];
}

const MonthlyInventory: React.FC<{ user: User }> = ({ user }) => {
  const [departmentId, setDepartmentId] = useState<number | ''>(
    user.role === 'super_admin' ? '' : (user.department_id ?? '')
  );
  const [month, setMonth] = useState<number>(new Date().getMonth() + 1);
  const [year,  setYear]  = useState<number>(new Date().getFullYear());
  const [loading, setLoading] = useState(false);

  const [categories, setCategories] = useState<Category[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [rows, setRows] = useState<MonthlyRow[]>([]);

  // ===== Helpers de nombres =====
  const catName = (id: number) => categories.find(c => c.id === id)?.name ?? '—';
  const itemById = (id: number) => items.find(i => i.id === id);

  const allNotesFilled = useMemo(
    () => rows.every(r => (r.diff === 0 ? true : r.notes.trim().length > 0)),
    [rows]
  );

  // ====== CARGA PRINCIPAL (con Qty Previous del mes anterior) ======
  async function loadData() {
    const deptId = user.role === 'super_admin' ? Number(departmentId) : Number(user.department_id);
    if (!deptId) return;

    setLoading(true);
    try {
      // 1) Catálogos
      const [catsRes, itemsRes] = await Promise.all([
        supabase.from('categories').select('id,name'),
        supabase.from('items').select('id,name,category_id,article_number')
      ]);
      if (catsRes.error) throw catsRes.error;
      if (itemsRes.error) throw itemsRes.error;
      setCategories(catsRes.data ?? []);
      setItems(itemsRes.data ?? []);

      // 2) Áreas del departamento
      const areasRes = await supabase
        .from('areas')
        .select('id,department_id')
        .eq('department_id', deptId);
      if (areasRes.error) throw areasRes.error;
      const areaIds = (areasRes.data ?? []).map((a:any)=>Number(a.id));

      // 3) Totales ACTUALES = suma de items en el ÚLTIMO record de CADA área
      const currentTotals = new Map<number, number>(); // item_id -> qty
      if (areaIds.length) {
        const recPromises = areaIds.map((areaId:number) =>
          supabase.from('records')
            .select('id,area_id,inventory_date,created_at')
            .eq('area_id', areaId)
            .order('inventory_date', { ascending:false })
            .order('created_at', { ascending:false })
            .limit(1)
        );
        const recResults = await Promise.all(recPromises);
        const latest = recResults
          .map(r => (r.error || !r.data?.length ? null : r.data[0]))
          .filter(Boolean) as {id:number}[];

        if (latest.length) {
          const recordIds = latest.map(r => r.id);
          const riRes = await supabase.from('record_items').select('record_id,item_id,qty');
          if (riRes.error) throw riRes.error;
          const ri = (riRes.data ?? []).filter((r:any)=>recordIds.includes(Number(r.record_id)));
          ri.forEach((r:any)=>{
            const iid = Number(r.item_id);
            const q = Number(r.qty ?? 0);
            currentTotals.set(iid, (currentTotals.get(iid) ?? 0) + q);
          });
        }
      }

      // 4) PREVIOUS = monthly_inventories del MES ANTERIOR (mismo depto), excluyendo headers sin item_id
      const prevM = month === 1 ? 12 : month - 1;
      const prevY = month === 1 ? year - 1 : year;
      const prevRes = await supabase
        .from('monthly_inventories')
        .select('item_id,qty_total')
        .match({ department_id: deptId, month: prevM, year: prevY })
        .not('item_id', 'is', null);
      if (prevRes.error) throw prevRes.error;
      const prevTotals = new Map<number, number>();
      (prevRes.data ?? []).forEach((r:any)=>{
        const iid = Number(r.item_id);
        const q = Number(r.qty_total ?? 0);
        prevTotals.set(iid, (prevTotals.get(iid) ?? 0) + q);
      });

      // 5) UNIÓN: items con actuales ∪ previos (para que SIEMPRE haya filas)
      const itemIds = new Set<number>([
        ...Array.from(currentTotals.keys()),
        ...Array.from(prevTotals.keys()),
      ]);

      const built: MonthlyRow[] = Array.from(itemIds).map(item_id=>{
        const it = itemById(item_id);
        const current = currentTotals.get(item_id) ?? 0;
        const previous = prevTotals.get(item_id) ?? 0;
        const cid = it?.category_id ?? 0;
        return {
          category_id: cid,
          category_name: catName(cid),
          item_id,
          item_name: it?.name ?? `Item ${item_id}`,
          item_number: it?.article_number ?? null,
          qty_current_total: current,
          qty_prev_total: previous,
          diff: current - previous,
          notes: ''
        };
      });

      built.sort((a,b)=> a.category_name.localeCompare(b.category_name) || a.item_name.localeCompare(b.item_name));
      setRows(built);
    } catch (e:any) {
      console.error(e);
      alert('Error cargando datos. Revisa "categories", "items", "areas", "records/record_items" y "monthly_inventories".');
    } finally {
      setLoading(false);
    }
  }

  // ====== Guardar ======
  const canSave = rows.length>0 && allNotesFilled;
  async function saveMonthly() {
    if (!canSave) return;
    const deptId = user.role === 'super_admin' ? Number(departmentId) : Number(user.department_id);
    if (!deptId) return;

    try {
      setLoading(true);
      const payload = rows.map(r => ({
        department_id: deptId,
        category_id: r.category_id,
        item_id: r.item_id,
        qty_total: r.qty_current_total,
        month, year,
        notes: r.notes
      }));
      const { error } = await supabase
        .from('monthly_inventories')
        .upsert(payload, { onConflict: 'department_id,item_id,month,year' });
      if (error) throw error;
      alert('Monthly Inventory guardado.');
    } catch (e:any) {
      console.error(e);
      alert('Error al guardar.');
    } finally {
      setLoading(false);
    }
  }

  // ====== Estilos de fila por diferencia ======
  function rowBg(diff:number, current:number): React.CSSProperties {
    if (diff < 0)   return { background:'#ffe5e5' };   // rojo suave
    if (diff === 0) return { background:'#e8f5e9' };   // verde suave
    if (diff === current) return { background:'#e3f2fd' }; // azul (prev=0)
    return { background:'#fff3e0' };                  // naranja suave
  }

  // ====== Agrupación por categoría para la tabla ======
  const grouped = useMemo(()=>{
    const map = new Map<number, { name:string; items:MonthlyRow[]; delta:number }>();
    rows.forEach(r=>{
      if (!map.has(r.category_id)) map.set(r.category_id, { name:r.category_name, items:[], delta:0 });
      const g = map.get(r.category_id)!;
      g.items.push(r);
      g.delta += (r.qty_current_total - r.qty_prev_total);
    });
    return Array.from(map.entries())
      .sort((a,b)=>a[1].name.localeCompare(b[1].name))
      .map(([cid, g])=>({ category_id: cid, category_name: g.name, items:g.items, delta:g.delta }));
  }, [rows]);

  // ====== Cargas automáticas ======
  useEffect(()=>{ loadData(); /* al montar */ }, []);
  useEffect(()=>{ loadData(); /* al cambiar mes/año */ }, [month, year]);
  useEffect(()=>{
    if (user.role === 'super_admin') { if (departmentId) loadData(); }
    // admin/standard ya se carga con dept del usuario
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [departmentId]);

  return (
    <div className="p-6 max-w-[1200px] mx-auto">
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
              <option value="">Select…</option>
              {/* Si quieres llenar dinámicamente, cambia esto por un fetch de departments */}
              <option value={1}>Dept 1</option>
              <option value={2}>Dept 2</option>
            </select>
          </div>
        )}

        <div className="flex flex-col">
          <label className="text-sm font-medium mb-1">Month</label>
          <select
            className="border rounded px-3 py-2"
            value={month}
            onChange={e => setMonth(Number(e.target.value))}
          >
            {Array.from({length:12},(_,i)=>i+1).map(m=>(
              <option key={m} value={m}>{monthLabel(m)}</option>
            ))}
          </select>
        </div>

        <div className="flex flex-col">
          <label className="text-sm font-medium mb-1">Year</label>
          <input
            type="number"
            className="border rounded px-3 py-2 w-[120px]"
            value={year}
            onChange={e=>setYear(Number(e.target.value))}
          />
        </div>
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
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-gray-500">
                    {loading ? 'Cargando…' : 'No hay datos para mostrar.'}
                  </td>
                </tr>
              ) : (
                grouped.map(group => (
                  <React.Fragment key={group.category_id}>
                    {/* Fila de categoría (verde suave y negrita) */}
                    <tr
                      style={{
                        backgroundColor:'#d9f9d9',
                        fontWeight:600,
                        borderTopLeftRadius:'8px',
                        borderTopRightRadius:'8px',
                        boxShadow:'0 2px 4px rgba(0,0,0,0.05)'
                      }}
                    >
                      <td className="px-3 py-2 border-b" colSpan={4}>{group.category_name}</td>
                      <td className="px-3 py-2 border-b text-right">—</td>
                      <td className="px-3 py-2 border-b text-right">
                        {group.delta > 0 ? `+${group.delta}` : group.delta}
                      </td>
                      <td className="px-3 py-2 border-b">—</td>
                    </tr>

                    {group.items.map(r => (
                      <tr key={r.item_id} style={rowBg(r.diff, r.qty_current_total)}>
                        <td className="px-3 py-2">{r.item_name}</td>
                        <td className="px-3 py-2">{r.item_number ?? '—'}</td>
                        <td className="px-3 py-2 text-right">{r.qty_current_total}</td>
                        <td className="px-3 py-2 text-right">{r.qty_prev_total}</td>
                        <td className="px-3 py-2 text-right">{r.diff>0?`+${r.diff}`:r.diff}</td>
                        <td className="px-3 py-2 text-right">—</td>
                        <td className="px-3 py-2">
                          {r.diff === 0 ? '—' : (
                            <input
                              className="border rounded px-2 py-1 w-full"
                              placeholder="Required (diff ≠ 0)"
                              value={r.notes}
                              onChange={e=>{
                                const v=e.target.value;
                                setRows(prev=>prev.map(x=>x.item_id===r.item_id?{...x,notes:v}:x));
                              }}
                            />
                          )}
                        </td>
                      </tr>
                    ))}
                  </React.Fragment>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Acciones */}
      <div className="flex items-center gap-3 mt-4">
        <button
          className={`px-4 py-2 rounded text-white ${canSave?'bg-green-600':'bg-gray-400 cursor-not-allowed'}`}
          disabled={!canSave || loading}
          onClick={saveMonthly}
        >
          Save Monthly Inventory
        </button>
      </div>
    </div>
  );
};

export default MonthlyInventory;
