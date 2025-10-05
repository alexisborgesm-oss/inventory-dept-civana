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
type PastCol = { month: number; year: number; label: string }; // ej. {9,2025,'Sep'}

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
  const [pastColumns, setPastColumns] = useState<PastCol[]>([]);
  const [pastGrouped, setPastGrouped] = useState<
    Array<{
      category_id: number;
      category_name: string;
      items: Array<{
        item_id: number;
        item_name: string;
        item_number: string | null;
        qty_current: number; // up to date
        qty_by_col: number[]; // en el mismo orden que pastColumns
        notes_concat: string; // "Sep: ..., Aug: ..., ..."
      }>;
    }>
  >([]);

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

  // ==== helpers ====
  const monthShort = (m: number) =>
    new Date(2000, m - 1, 1).toLocaleString("en", { month: "short" });
  const makePastCols = (count: number, curM: number, curY: number): PastCol[] => {
    const cols: PastCol[] = [];
    let m = curM;
    let y = curY;
    for (let i = 0; i < count; i++) {
      m = m === 1 ? 12 : m - 1;
      y = m === 12 ? y - 1 : y;
      cols.push({ month: m, year: y, label: monthShort(m) });
    }
    return cols; // orden: más reciente primero (Sep, Aug, Jul…)
  };

  async function loadCurrentTotals() {
    const deptId = user.role === "super_admin" ? Number(departmentId) : Number(user.department_id);
    if (!deptId) return;

    setLoading(true);
    setPastGrouped([]);

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

      // 3) Totales actuales
      let currentTotals = new Map<number, number>();
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
        .from("monthly_inventories")
        .select("item_id, qty_total")
        .match({ department_id: deptId, month: prevM, year: prevY })
        .not("item_id", "is", null);
      if (prevErr) throw prevErr;

      const prevTotals = new Map<number, number>();
      (prevData ?? []).forEach((r: any) => {
        const iid = Number(r.item_id);
        const q = Number(r.qty_total ?? 0);
        prevTotals.set(iid, (prevTotals.get(iid) ?? 0) + q);
      });

      // 5) Unión de ítems: actuales ∪ previos
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
    if (diff < 0) return "bg-red-100";
    if (diff === 0) return "bg-green-100";
    if (diff === current) return "bg-blue-100";
    if (diff > 0) return "bg-orange-100";
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

  // ======= Tabla inferior (past inventories) =======
  const makePastInventories = async () => {
    const deptId = user.role === "super_admin" ? Number(departmentId) : Number(user.department_id);
    if (!deptId) return;

    const cols = makePastCols(pastCount, month, year);
    setPastColumns(cols);

    const currentByItem = new Map<number, number>();
    rows.forEach((r) => currentByItem.set(r.item_id, r.qty_current_total));

    const monthFetches = await Promise.all(
      cols.map((c) =>
        supabase
          .from("monthly_inventories")
          .select("item_id, qty_total, notes")
          .match({ department_id: deptId, month: c.month, year: c.year })
          .not("item_id", "is", null)
      )
    );

    const perColQty: Array<Map<number, number>> = [];
    const perColNotes: Array<Map<number, string>> = [];
    monthFetches.forEach((res) => {
      const qMap = new Map<number, number>();
      const nMap = new Map<number, string>();
      if (!res.error && res.data) {
        (res.data as any[]).forEach((r) => {
          const iid = Number(r.item_id);
          qMap.set(iid, Number(r.qty_total ?? 0));
          if (r.notes) nMap.set(iid, String(r.notes));
        });
      }
      perColQty.push(qMap);
      perColNotes.push(nMap);
    });

    const allItemIds = new Set<number>(Array.from(currentByItem.keys()));
    perColQty.forEach((m) => m.forEach((_v, k) => allItemIds.add(k)));

    const byCat = new Map<
      number,
      {
        category_name: string;
        items: Array<{
          item_id: number;
          item_name: string;
          item_number: string | null;
          qty_current: number;
          qty_by_col: number[];
          notes_concat: string;
        }>;
      }
    >();

    const catName = (cid: number) => categories.find((c) => c.id === cid)?.name ?? "—";

    allItemIds.forEach((item_id) => {
      const it = items.find((i) => i.id === item_id);
      const cid = it?.category_id ?? 0;
      if (!byCat.has(cid)) byCat.set(cid, { category_name: catName(cid), items: [] });

      const qty_current = currentByItem.get(item_id) ?? 0;
      const qty_by_col = cols.map((_c, idx) => perColQty[idx].get(item_id) ?? 0);

      const notes_concat = cols
        .map((c, idx) => {
          const note = perColNotes[idx].get(item_id);
          return note ? `${c.label}: ${note}` : null;
        })
        .filter(Boolean)
        .join(", ");

      byCat.get(cid)!.items.push({
        item_id,
        item_name: it?.name ?? `Item ${item_id}`,
        item_number: it?.article_number ?? null,
        qty_current,
        qty_by_col,
        notes_concat,
      });
    });

    const grouped = Array.from(byCat.entries())
      .map(([category_id, g]) => ({
        category_id,
        category_name: g.category_name,
        items: g.items.sort((a, b) => a.item_name.localeCompare(b.item_name)),
      }))
      .sort((a, b) => a.category_name.localeCompare(b.category_name));

    setPastGrouped(grouped);
  };

  useEffect(() => {
    loadCurrentTotals();
  }, []);

  // ==== helpers de estilo (inputs/botones coherentes con el tema) ====
  const inputBase =
    "border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-300 bg-white";
  const selectBase =
    "border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-300 bg-white";
  const btnPrimary =
    "inline-flex items-center gap-2 rounded-md bg-green-600 text-white px-4 py-2 text-sm font-medium hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 disabled:bg-gray-400 disabled:cursor-not-allowed";
  const btnSecondary =
    "inline-flex items-center gap-2 rounded-md bg-blue-600 text-white px-3 py-2 text-sm font-medium hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500";

  // Render de notas con mes en negrita: "Sep: texto, Aug: texto"
  const renderNotesPretty = (notesConcat: string) => {
    if (!notesConcat) return "—";
    const parts = notesConcat.split(", ").filter(Boolean);
    return (
      <div className="space-y-0.5">
        {parts.map((p, idx) => {
          const [monthLabel, ...rest] = p.split(": ");
          const restText = rest.join(": ");
          return (
            <div key={idx}>
              <span className="font-semibold">{monthLabel}:</span>{" "}
              <span>{restText}</span>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="p-6">
      <h2 className="text-2xl font-semibold mb-4">Monthly Inventory</h2>

      {/* Filtros */}
      <div className="mb-4 flex items-end flex-wrap gap-4">
        <div className="flex flex-col">
          <label className="text-sm text-gray-700 mb-1">Month</label>
          <select
            value={month}
            onChange={(e) => setMonth(Number(e.target.value))}
            className={selectBase}
          >
            {Array.from({ length: 12 }, (_, i) => (
              <option key={i + 1} value={i + 1}>
                {new Date(0, i).toLocaleString("en", { month: "short" }).toUpperCase()}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col">
          <label className="text-sm text-gray-700 mb-1">Year</label>
          <input
            type="number"
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            className={inputBase + " w-28"}
          />
        </div>
      </div>

      {/* ======= TABLA SUPERIOR ======= */}
      <div className="rounded-lg border border-gray-200 overflow-hidden bg-white shadow-sm">
        <table className="min-w-full">
          <thead className="bg-gray-50 text-gray-700">
            <tr>
              <th className="p-3 border-b text-left text-sm font-medium">Category / Item</th>
              <th className="p-3 border-b text-left text-sm font-medium">Item Number</th>
              <th className="p-3 border-b text-right text-sm font-medium">Qty (Current)</th>
              <th className="p-3 border-b text-right text-sm font-medium">Qty (Previous)</th>
              <th className="p-3 border-b text-right text-sm font-medium">Δ (Item)</th>
              <th className="p-3 border-b text-right text-sm font-medium">Δ (Category Total)</th>
              <th className="p-3 border-b text-left text-sm font-medium">Notes</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="text-center p-6 text-gray-500">
                  {loading ? "Cargando..." : "No hay datos para mostrar."}
                </td>
              </tr>
            ) : (
              (() => {
                const groupedRows = [];
                let lastCategory = "";

                for (let i = 0; i < rows.length; i++) {
                  const r = rows[i];

                  if (r.category_name !== lastCategory) {
                    lastCategory = r.category_name;
                    groupedRows.push(
                      <tr
                        key={`cat-${r.category_id}-${i}`}
                        style={{
                          backgroundColor: "#d9f9d9",
                          fontWeight: 600,
                          boxShadow: "0 1px 0 #b6e7b6 inset, 0 -1px 0 #b6e7b6 inset",
                        }}
                      >
                        <td colSpan={7} className="p-2 text-gray-800">
                          {r.category_name}
                        </td>
                      </tr>
                    );
                  }

                  groupedRows.push(
                    <tr key={i} className={getColor(r.diff, r.qty_current_total)}>
                      <td className="border-t p-3 pl-6">{r.item_name}</td>
                      <td className="border-t p-3 text-center">{r.item_number || "—"}</td>
                      <td className="border-t p-3 text-right">{r.qty_current_total}</td>
                      <td className="border-t p-3 text-right">{r.qty_prev_total}</td>
                      <td className="border-t p-3 text-right">{r.diff}</td>
                      <td className="border-t p-3 text-right">{r.diff === 0 ? "—" : r.diff}</td>
                      <td className="border-t p-3">
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
                            className={inputBase + " w-56"}
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
      </div>

      <div className="mt-4">
        <button
          disabled={!allNotesFilled}
          onClick={saveMonthlyInventory}
          className={btnPrimary}
        >
          Save Monthly Inventory
        </button>
      </div>

      {/* ======= CONTROLES TABLA INFERIOR ======= */}
      <div className="mt-6 flex items-center gap-3">
        <label className="text-sm text-gray-700">Show last</label>
        <input
          type="number"
          min={1}
          max={11}
          value={pastCount}
          onChange={(e) => setPastCount(Number(e.target.value))}
          className={inputBase + " w-20"}
        />
        <span className="text-sm text-gray-700">inventories</span>
        <button onClick={makePastInventories} className={btnSecondary}>
          Past Inventories
        </button>
      </div>

      {/* ======= TABLA INFERIOR (agrupada) ======= */}
      {pastGrouped.length > 0 && (
        <div className="mt-4 rounded-lg border border-gray-200 overflow-hidden bg-white shadow-sm">
          <table className="min-w-full">
            <thead className="bg-gray-50 text-gray-700">
              <tr>
                <th className="p-3 border-b text-left text-sm font-medium">Category / Item</th>
                <th className="p-3 border-b text-left text-sm font-medium">Item Number</th>
                <th className="p-3 border-b text-right text-sm font-medium">Qty (Up to date)</th>
                {pastColumns.map((c) => (
                  <th
                    key={`${c.year}-${c.month}`}
                    className="p-3 border-b text-right text-sm font-medium"
                  >
                    Qty ({c.label})
                  </th>
                ))}
                <th className="p-3 border-b text-left text-sm font-medium">Grouped Notes</th>
              </tr>
            </thead>
            <tbody>
              {pastGrouped.map((grp, gi) => (
                <React.Fragment key={`grp-${grp.category_id}-${gi}`}>
                  {/* Fila categoría */}
                  <tr
                    style={{
                      backgroundColor: "#d9f9d9",
                      fontWeight: 600,
                      boxShadow: "0 1px 0 #b6e7b6 inset, 0 -1px 0 #b6e7b6 inset",
                    }}
                  >
                    <td className="p-2" colSpan={2}>
                      {grp.category_name}
                    </td>
                    <td className="p-2 text-right">—</td>
                    {pastColumns.map((_, idx) => (
                      <td key={`c-${idx}`} className="p-2 text-right">
                        —
                      </td>
                    ))}
                    <td className="p-2">—</td>
                  </tr>

                  {/* Filas de ítems */}
                  {grp.items.map((it) => (
                    <tr key={`it-${grp.category_id}-${it.item_id}`}>
                      <td className="border-t p-3 pl-6">{it.item_name}</td>
                      <td className="border-t p-3 text-center">{it.item_number || "—"}</td>
                      <td className="border-t p-3 text-right">{it.qty_current}</td>
                      {it.qty_by_col.map((q, qi) => (
                        <td key={`q-${qi}`} className="border-t p-3 text-right">
                          {q}
                        </td>
                      ))}
                      <td className="border-t p-3">{renderNotesPretty(it.notes_concat)}</td>
                    </tr>
                  ))}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default MonthlyInventory;
