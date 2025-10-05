import React, { useEffect, useState } from "react";
import { supabase } from "../utils/supabase";

type User = {
  id: string;
  username: string;
  role: "super_admin" | "admin" | "standard";
  department_id: number | null;
};

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

type Category = { id: number; name: string };
type Item = { id: number; name: string; category_id: number; article_number?: string | null };

const MonthlyInventory: React.FC<{ user: User }> = ({ user }) => {
  const [rows, setRows] = useState<MonthlyRow[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [month, setMonth] = useState<number>(new Date().getMonth() + 1);
  const [year, setYear] = useState<number>(new Date().getFullYear());
  const [departmentId, setDepartmentId] = useState<number | "">(
    user.role === "super_admin" ? "" : user.department_id || ""
  );
  const [loading, setLoading] = useState(false);
  const [pastCount, setPastCount] = useState(3);
  const [pastTable, setPastTable] = useState<any[]>([]);

  useEffect(() => {
    if (user.role !== "super_admin" && user.department_id) {
      loadCurrentTotals();
    } else if (user.role === "super_admin" && departmentId) {
      loadCurrentTotals();
    }
  }, [departmentId]);
  useEffect(() => {
  loadCurrentTotals();
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [month, year]);
async function loadCurrentTotals() {
  const deptId = user.role === "super_admin" ? Number(departmentId) : Number(user.department_id);
  if (!deptId) return;

  setLoading(true);
  setPastTable([]);

  try {
    // 1) Catálogos
    const { data: itemsData, error: itemsErr } = await supabase
      .from("items")
      .select("id, name, category_id, article_number");
    if (itemsErr) throw itemsErr;

    const { data: catsData, error: catsErr } = await supabase
      .from("categories")
      .select("id, name");
    if (catsErr) throw catsErr;

    setItems(itemsData || []);
    setCategories(catsData || []);

    // 2) Áreas del depto
    const { data: areasData, error: areasErr } = await supabase
      .from("areas")
      .select("id, department_id")
      .eq("department_id", deptId);
    if (areasErr) throw areasErr;

    const areaIds = (areasData || []).map((a: any) => a.id);

    // 3) Totales actuales (suma del último record de CADA área)
    let currentTotals = new Map<number, number>(); // item_id -> qty
    if (areaIds.length) {
      const recPromises = areaIds.map((areaId: number) =>
        supabase
          .from("records")
          .select("id, area_id, inventory_date, created_at")
          .eq("area_id", areaId)
          .order("inventory_date", { ascending: false })
          .order("created_at", { ascending: false })
          .limit(1)
      );
      const recResults = await Promise.all(recPromises);
      const latestRecords = recResults
        .map((r) => (r.error || !r.data?.length ? null : r.data[0]))
        .filter(Boolean) as { id: number }[];

      if (latestRecords.length) {
        const recordIds = latestRecords.map((r) => r.id);
        const { data: riData, error: riErr } = await supabase
          .from("record_items")
          .select("record_id, item_id, qty");
        if (riErr) throw riErr;

        const riRows = (riData || []).filter((r: any) => recordIds.includes(r.record_id));
        riRows.forEach((r: any) => {
          currentTotals.set(r.item_id, (currentTotals.get(r.item_id) || 0) + (r.qty || 0));
        });
      }
    }

    // 4) Mes anterior inmediato (previo)
    const prevM = month === 1 ? 12 : month - 1;
    const prevY = month === 1 ? year - 1 : year;
    const { data: prevData, error: prevErr } = await supabase
  .from('monthly_inventories')
  .select('item_id, qty_total')
  .match({ department_id: deptId, month: prevM, year: prevY })
  .not('item_id', 'is', null);
    if (prevErr) throw prevErr;

    const prevTotals = new Map<number, number>();
(prevData ?? []).forEach((r: any) => {
  const iid = Number(r.item_id);
  const q = Number(r.qty_total ?? 0);
  prevTotals.set(iid, (prevTotals.get(iid) ?? 0) + q);
});

    // 5) Unión de ítems: actuales ∪ previos (para que SIEMPRE haya filas)
    const itemIds = new Set<number>([
      ...Array.from(currentTotals.keys()),
      ...Array.from(prevTotals.keys()),
    ]);

    // 6) Construcción de filas
    const catName = (id: number) => (catsData || []).find((c) => c.id === id)?.name ?? "—";
    const built: MonthlyRow[] = Array.from(itemIds).map((item_id) => {
      const it = (itemsData || []).find((i) => i.id === item_id);
      const current = currentTotals.get(item_id) ?? 0;
      const previous = prevTotals.get(item_id) ?? 0;
      return {
        category_id: it?.category_id ?? 0,
        category_name: catName(it?.category_id ?? 0),
        item_id,
        item_name: it?.name ?? `Item ${item_id}`,
        item_number: it?.article_number ?? null,
        qty_current_total: current,
        qty_prev_total: previous,
        diff: current - previous,
        notes: "",
      };
    });

    built.sort((a, b) =>
      a.category_name.localeCompare(b.category_name) || a.item_name.localeCompare(b.item_name)
    );

    setRows(built);
  } catch (err) {
    console.error(err);
    alert(
      'Error cargando datos. Revisa que existan "items", "categories", "areas", "records/record_items" y "monthly_inventories".'
    );
  } finally {
    setLoading(false);
  }
}

 


  function getColor(diff: number, current: number): string {
    if (diff < 0) return "bg-red-200";
    if (diff === 0) return "bg-green-200";
    if (diff === current) return "bg-blue-200";
    if (diff > 0) return "bg-orange-200";
    return "";
  }

  const allNotesFilled = rows.every(
    (r) => r.diff === 0 || (r.notes && r.notes.trim().length > 0)
  );

  async function saveMonthlyInventory() {
    if (!allNotesFilled) {
      alert("Completa todas las notas antes de guardar.");
      return;
    }

    const deptId = user.role === "super_admin" ? Number(departmentId) : Number(user.department_id);
    const insertRows = rows.map((r) => ({
      department_id: deptId,
      category_id: r.category_id,
      item_id: r.item_id,
      qty_total: r.qty_current_total,
      month,
      year,
      notes: r.notes,
    }));

    const { error } = await supabase.from("monthly_inventories").insert(insertRows);
    if (error) {
      alert("Error guardando inventario mensual.");
      console.error(error);
    } else {
      alert("Inventario mensual guardado correctamente.");
    }
  }

  async function loadPastInventories() {
    const deptId = user.role === "super_admin" ? Number(departmentId) : Number(user.department_id);
    if (!deptId) return;
    const { data, error } = await supabase
      .from("monthly_inventories")
      .select("item_id, qty_total, month, notes")
      .eq("department_id", deptId)
      .order("year", { ascending: false })
      .order("month", { ascending: false })
      .limit(pastCount * items.length);
    if (error) {
      console.error(error);
      return;
    }

    const grouped: Record<number, any> = {};
    (data || []).forEach((r: any) => {
      if (!grouped[r.item_id]) grouped[r.item_id] = { item_id: r.item_id, months: [], notes: [] };
      grouped[r.item_id].months.push(r.qty_total);
      if (r.notes) grouped[r.item_id].notes.push(`${r.month}: ${r.notes}`);
    });

    const result = Object.values(grouped).map((r: any) => {
      const it = items.find((i) => i.id === r.item_id);
      return {
        item_name: it?.name || `Item ${r.item_id}`,
        item_number: it?.article_number || null,
        qtys: r.months,
        notes: r.notes.join(", "),
      };
    });

    setPastTable(result);
  }

  useEffect(() => {
    // ejecuta automáticamente la carga al abrir la vista
    loadCurrentTotals();
  }, []);

  return (
    <div className="p-6">
      <h2 className="text-2xl font-bold mb-4">Monthly Inventory</h2>
      <div className="mb-2 flex items-center gap-3">
        <label>Month</label>
        <select
          value={month}
          onChange={(e) => setMonth(Number(e.target.value))}
          className="border p-1 rounded"
        >
          {Array.from({ length: 12 }, (_, i) => (
            <option key={i + 1} value={i + 1}>
              {new Date(0, i).toLocaleString("en", { month: "short" }).toUpperCase()}
            </option>
          ))}
        </select>
        <label>Year</label>
        <input
          type="number"
          value={year}
          onChange={(e) => setYear(Number(e.target.value))}
          className="border p-1 w-24 rounded"
        />
      </div>

      <table className="min-w-full border mt-4">
        <thead className="bg-gray-200">
          <tr>
            <th className="p-2 border">Category / Item</th>
            <th className="p-2 border">Item Number</th>
            <th className="p-2 border">Qty (Current)</th>
            <th className="p-2 border">Qty (Previous)</th>
            <th className="p-2 border">Δ (Item)</th>
            <th className="p-2 border">Δ (Category Total)</th>
            <th className="p-2 border">Notes</th>
          </tr>
        </thead>
 <tbody>
  {rows.length === 0 ? (
    <tr>
      <td colSpan={7} className="text-center p-3">
        {loading ? "Cargando..." : "No hay datos para mostrar."}
      </td>
    </tr>
  ) : (
    (() => {
      const groupedRows = [];
      let lastCategory = "";

      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];

        // Si cambia la categoría, insertamos una fila de encabezado visualmente destacada
        if (r.category_name !== lastCategory) {
          lastCategory = r.category_name;
          groupedRows.push(
            <tr
              key={`cat-${r.category_id}-${i}`}
              style={{
                backgroundColor: "#d9f9d9", // verde pastel suave
                fontWeight: "600",           // negrita
                borderTopLeftRadius: "8px",
                borderTopRightRadius: "8px",
                boxShadow: "0 2px 4px rgba(0,0,0,0.05)",
              }}
            >
              <td
                colSpan={7}
                className="p-2 border-b text-gray-800"
                style={{
                  borderTop: "1px solid #b6e7b6",
                  borderBottom: "1px solid #b6e7b6",
                }}
              >
                {r.category_name}
              </td>
            </tr>
          );
        }

        // Fila del artículo
        groupedRows.push(
          <tr key={i} className={getColor(r.diff, r.qty_current_total)}>
            <td className="border p-2 pl-6">{r.item_name}</td>
            <td className="border p-2 text-center">{r.item_number || "—"}</td>
            <td className="border p-2 text-center">{r.qty_current_total}</td>
            <td className="border p-2 text-center">{r.qty_prev_total}</td>
            <td className="border p-2 text-center">{r.diff}</td>
            <td className="border p-2 text-center">
              {r.diff === 0 ? "—" : r.diff}
            </td>
            <td className="border p-2 text-center">
              {r.diff === 0 ? (
                "—"
              ) : (
                <input
                  type="text"
                  value={r.notes}
                  onChange={(e) => {
                    const val = e.target.value;
                    setRows((prev) =>
                      prev.map((x, idx) => (idx === i ? { ...x, notes: val } : x))
                    );
                  }}
                  className="border border-gray-300 p-1 w-40 rounded focus:ring-2 focus:ring-green-300"
                  placeholder="Required (diff ≠ 0)"
                />
              )}
            </td>
          </tr>
        );
      }

      return groupedRows;
    })()
  )}
</tbody>



      </table>

      <button
        disabled={!allNotesFilled}
        onClick={saveMonthlyInventory}
        className={`mt-4 px-4 py-2 rounded text-white ${
          allNotesFilled ? "bg-green-600" : "bg-gray-400 cursor-not-allowed"
        }`}
      >
        Save Monthly Inventory
      </button>

      <div className="mt-4 flex items-center gap-2">
        <label>Show last</label>
        <input
          type="number"
          min={1}
          max={11}
          value={pastCount}
          onChange={(e) => setPastCount(Number(e.target.value))}
          className="border p-1 w-16 rounded"
        />
        <span>inventories</span>
        <button
          onClick={loadPastInventories}
          className="ml-2 bg-blue-600 text-white px-3 py-1 rounded"
        >
          Past Inventories
        </button>
      </div>

      {pastTable.length > 0 && (
        <table className="min-w-full border mt-4">
          <thead className="bg-gray-200">
            <tr>
              <th className="p-2 border">Category / Item</th>
              <th className="p-2 border">Item Number</th>
              <th className="p-2 border">Qty (Current)</th>
              <th className="p-2 border">Grouped Notes</th>
            </tr>
          </thead>
          <tbody>
            {pastTable.map((r, i) => (
              <tr key={i}>
                <td className="border p-2">{r.item_name}</td>
                <td className="border p-2 text-center">{r.item_number || "—"}</td>
                <td className="border p-2 text-center">{r.qtys.join(", ")}</td>
                <td className="border p-2">{r.notes}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
};

export default MonthlyInventory;
