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

  async function loadCurrentTotals() {
    const deptId = user.role === "super_admin" ? Number(departmentId) : Number(user.department_id);
    if (!deptId) return;

    setLoading(true);
    setPastTable([]);

    try {
      // 1️⃣ Cargar catálogos
      const [areasRes, itemsRes, catsRes] = await Promise.all([
        supabase.from("areas").select("id, department_id").eq("department_id", deptId),
        supabase.from("items").select("id, name, category_id, article_number"),
        supabase.from("categories").select("id, name"),
      ]);
      if (areasRes.error) throw areasRes.error;
      if (itemsRes.error) throw itemsRes.error;
      if (catsRes.error) throw catsRes.error;

      setItems(itemsRes.data || []);
      setCategories(catsRes.data || []);

      const areaIds = (areasRes.data || []).map((a: any) => a.id);
      if (areaIds.length === 0) {
        setRows([]);
        return;
      }

      // 2️⃣ Últimos records por área
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

      if (latestRecords.length === 0) {
        setRows([]);
        return;
      }

      // 3️⃣ Traer items de esos records
      const recordIds = latestRecords.map((r) => r.id);
      const riRes = await supabase.from("record_items").select("record_id, item_id, qty");
      if (riRes.error) throw riRes.error;
      const riRows = (riRes.data || []).filter((r: any) => recordIds.includes(r.record_id));

      const totals = new Map<number, number>();
      riRows.forEach((r: any) => {
        totals.set(r.item_id, (totals.get(r.item_id) || 0) + (r.qty || 0));
      });

      // 4️⃣ Mes anterior inmediato
      const prevM = month === 1 ? 12 : month - 1;
      const prevY = month === 1 ? year - 1 : year;
      const prevRes = await supabase
        .from("monthly_inventories")
        .select("item_id, qty_total")
        .eq("department_id", deptId)
        .eq("month", prevM)
        .eq("year", prevY);
      const prevMap = new Map<number, number>();
      if (!prevRes.error && prevRes.data) {
        prevRes.data.forEach((r: any) => prevMap.set(r.item_id, r.qty_total || 0));
      }

      // 5️⃣ Armar filas
      const catName = (id: number) => categories.find((c) => c.id === id)?.name || "—";
      const built = Array.from(totals.entries()).map(([item_id, qty]) => {
        const it = items.find((i) => i.id === item_id);
        const category_id = it?.category_id || 0;
        const prev = prevMap.get(item_id) || 0;
        return {
          category_id,
          category_name: catName(category_id),
          item_id,
          item_name: it?.name || `Item ${item_id}`,
          item_number: it?.article_number || null,
          qty_current_total: qty,
          qty_prev_total: prev,
          diff: qty - prev,
          notes: "",
        };
      });
      built.sort((a, b) =>
        a.category_name.localeCompare(b.category_name) || a.item_name.localeCompare(b.item_name)
      );
      setRows(built);
    } catch (err) {
      console.error(err);
      alert('Error cargando totales actuales. Revisa que existan y tengan datos las tablas "areas", "records" y "record_items".');
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
            rows.map((r, i) => (
              <tr key={i} className={getColor(r.diff, r.qty_current_total)}>
                <td className="border p-2">
                  <div className="font-semibold">{r.category_name}</div>
                  <div className="pl-4">{r.item_name}</div>
                </td>
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
                          prev.map((x, idx) =>
                            idx === i ? { ...x, notes: val } : x
                          )
                        );
                      }}
                      className="border p-1 w-40 rounded"
                      placeholder="Required (diff ≠ 0)"
                    />
                  )}
                </td>
              </tr>
            ))
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
