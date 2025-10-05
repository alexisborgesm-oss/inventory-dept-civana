import React, { useEffect, useState } from "react";
import { supabase } from "../utils/supabase";
import "./MonthlyInventory.css";
// 👇 Quitamos imports estáticos de exceljs y file-saver para evitar errores de build en Vercel
// import { Workbook } from "exceljs";
// import { saveAs } from "file-saver";

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
type PastCol = { month: number; year: number; label: string };

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
        qty_current: number;
        qty_by_col: number[];
        notes_concat: string;
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
    return cols;
  };

  async function loadCurrentTotals() {
    const deptId = user.role === "super_admin" ? Number(departmentId) : Number(user.department_id);
    if (!deptId) return;

    setLoading(true);
    setPastGrouped([]);

    try {
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

      const { data: areasData, error: areasErr } = await supabase
        .from("areas")
        .select("id, department_id")
        .eq("department_id", deptId);
      if (areasErr) throw areasErr;

      const areaIds = (areasData || []).map((a: any) => a.id);

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

      const prevM = month === 1 ? 12 : month - 1;
      const prevY = month === 1 ? year - 1 : year;
      const { data: prevData, error: prevErr } = await supabase
        .from("monthly_inventories")
        .select("item_id, qty_total")
        .match({ department_id: Number(deptId), month: prevM, year: prevY })
        .not("item_id", "is", null);
      if (prevErr) throw prevErr;

      const prevTotals = new Map<number, number>();
      (prevData ?? []).forEach((r: any) => {
        const iid = Number(r.item_id);
        const q = Number(r.qty_total ?? 0);
        prevTotals.set(iid, (prevTotals.get(iid) ?? 0) + q);
      });

      const itemIds = new Set<number>([
        ...Array.from(currentTotals.keys()),
        ...Array.from(prevTotals.keys()),
      ]);

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

  function getColorClass(diff: number, current: number): string {
    if (diff < 0) return "bg-red";
    if (diff === 0) return "bg-green";
    if (diff === current) return "bg-blue";
    if (diff > 0) return "bg-orange";
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

  // ======= Past inventories =======
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
          .match({ department_id: Number(deptId), month: c.month, year: c.year })
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
      const qty_by_col = pastColumns.length
        ? pastColumns.map((_c, idx) => perColQty[idx].get(item_id) ?? 0)
        : makePastCols(pastCount, month, year).map((_c, idx) => perColQty[idx].get(item_id) ?? 0);

      const baseCols = pastColumns.length ? pastColumns : makePastCols(pastCount, month, year);
      const notes_concat = baseCols
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

  // ======= Export helpers =======

  // Carga dinámica de exceljs + file-saver con fallback a CDN (para que NO falle el build en Vercel)
  async function getExcelDeps() {
    let WorkbookCtor: any;
    let saveAsFn: (blob: Blob, name?: string) => void;

    try {
      // @ts-ignore - puede no tener tipos en build
      const m = await import("exceljs");
      WorkbookCtor = m.Workbook;
    } catch (_e) {
      // @ts-ignore
      const m = await import("https://esm.sh/exceljs@4.3.0");
      WorkbookCtor = m.Workbook;
    }

    try {
      // @ts-ignore
      const m2 = await import("file-saver");
      saveAsFn = (m2.saveAs || m2.default) as typeof import("file-saver").saveAs;
    } catch (_e) {
      // @ts-ignore
      const m2 = await import("https://esm.sh/file-saver@2.0.5");
      saveAsFn = (m2.saveAs || m2.default) as any;
    }

    return { WorkbookCtor, saveAsFn };
  }

  // ===== Helpers de estilo para ExcelJS =====
  function applyHeaderStyle(cell: any) {
    cell.font = { bold: true, color: { argb: "FF374151" } };
    cell.alignment = { vertical: "middle", horizontal: "center" };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF3F4F6" } };
    cell.border = {
      top: { style: "thin", color: { argb: "FFE5E7EB" } },
      bottom: { style: "thin", color: { argb: "FFE5E7EB" } },
      left: { style: "thin", color: { argb: "FFE5E7EB" } },
      right: { style: "thin", color: { argb: "FFE5E7EB" } },
    };
  }

  function applyBodyBorder(cell: any) {
    cell.border = {
      top: { style: "thin", color: { argb: "FFE5E7EB" } },
      bottom: { style: "thin", color: { argb: "FFE5E7EB" } },
      left: { style: "thin", color: { argb: "FFE5E7EB" } },
      right: { style: "thin", color: { argb: "FFE5E7EB" } },
    };
  }

  function applyCategoryRowStyle(row: any) {
    row.eachCell((cell: any) => {
      cell.font = { bold: true };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD9F9D9" } };
      applyBodyBorder(cell);
    });
  }

  // ===== Export superior con estilos (usa deps dinámicas) =====
  async function exportTopToExcel() {
    if (!rows.length) {
      alert("No hay datos para exportar.");
      return;
    }

    const { WorkbookCtor, saveAsFn } = await getExcelDeps();
    const wb = new WorkbookCtor();
    const ws = wb.addWorksheet("Monthly");

    ws.columns = [
      { header: "Category / Item", key: "col1", width: 32 },
      { header: "Item Number", key: "col2", width: 16 },
      { header: "Qty (Current)", key: "col3", width: 16 },
      { header: "Qty (Previous)", key: "col4", width: 16 },
      { header: "Δ (Item)", key: "col5", width: 12 },
      { header: "Δ (Category Total)", key: "col6", width: 20 },
      { header: "Notes", key: "col7", width: 40 },
    ];

    const header = ws.getRow(1);
    header.values = ws.columns!.map((c) => c.header);
    header.height = 22;
    header.eachCell(applyHeaderStyle);

    let rIdx = 2;
    let lastCat = "";
    rows.forEach((r) => {
      if (r.category_name !== lastCat) {
        lastCat = r.category_name;
        const catRow = ws.getRow(rIdx++);
        catRow.getCell(1).value = r.category_name;
        applyCategoryRowStyle(catRow);
      }

      const row = ws.getRow(rIdx++);
      row.values = [
        r.item_name,
        r.item_number || "—",
        r.qty_current_total,
        r.qty_prev_total,
        r.diff,
        r.diff === 0 ? "—" : r.diff,
        r.diff === 0 ? "—" : (r.notes || ""),
      ];
      row.getCell(3).alignment = { horizontal: "right" };
      row.getCell(4).alignment = { horizontal: "right" };
      row.getCell(5).alignment = { horizontal: "right" };
      row.getCell(6).alignment = { horizontal: "right" };

      const bg =
        r.diff < 0
          ? "FFFFE5E5"
          : r.diff === 0
          ? "FFE8F5E9"
          : r.diff === r.qty_current_total
          ? "FFE3F2FD"
          : "FFFFF3E0";
      if (r.diff !== 0) {
        row.eachCell((cell: any) => {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bg } };
        });
      }
      row.eachCell(applyBodyBorder);
    });

    const buf = await wb.xlsx.writeBuffer();
    const fileName = `Monthly_${new Date(0, month - 1).toLocaleString("en", {
      month: "short",
    })}_${year}.xlsx`;
    saveAsFn(new Blob([buf]), fileName);
  }

  // ===== Export inferior con estilos (usa deps dinámicas) =====
  async function exportBottomToExcel() {
    if (!pastGrouped.length) {
      alert("No hay inventarios pasados para exportar.");
      return;
    }

    const cols = pastColumns.length ? pastColumns : makePastCols(pastCount, month, year);
    const { WorkbookCtor, saveAsFn } = await getExcelDeps();
    const wb = new WorkbookCtor();
    const ws = wb.addWorksheet("Past");

    const excelCols = [
      { header: "Category / Item", width: 32 },
      { header: "Item Number", width: 16 },
      { header: "Qty (Up to date)", width: 18 },
      ...cols.map((c) => ({ header: `Qty (${c.label})`, width: 14 })),
      { header: "Grouped Notes", width: 60 },
    ];
    ws.columns = excelCols.map((c, i) => ({ header: c.header, key: `c${i}`, width: c.width }));

    const header = ws.getRow(1);
    header.values = excelCols.map((c) => c.header);
    header.height = 22;
    header.eachCell(applyHeaderStyle);

    let rIdx = 2;
    pastGrouped.forEach((grp) => {
      const catRow = ws.getRow(rIdx++);
      catRow.getCell(1).value = grp.category_name;
      applyCategoryRowStyle(catRow);

      grp.items.forEach((it) => {
        const row = ws.getRow(rIdx++);
        row.getCell(1).value = it.item_name;
        row.getCell(2).value = it.item_number || "—";
        row.getCell(3).value = it.qty_current;
        it.qty_by_col.forEach((q, i) => (row.getCell(4 + i).value = q));

        const richParts: any[] = [];
        const parts = (it.notes_concat || "").split(", ").filter(Boolean);
        if (!parts.length) {
          row.getCell(4 + cols.length).value = "—";
        } else {
          parts.forEach((p, idx) => {
            const [m, ...rest] = p.split(": ");
            const text = rest.join(": ");
            richParts.push(
              { text: `${m}:`, font: { bold: true } },
              { text: ` ${text}${idx < parts.length - 1 ? ", " : ""}` }
            );
          });
          row.getCell(4 + cols.length).value = { richText: richParts };
        }

        row.eachCell(applyBodyBorder);
        row.getCell(3).alignment = { horizontal: "right" };
        for (let i = 0; i < cols.length; i++) {
          row.getCell(4 + i).alignment = { horizontal: "right" };
        }
      });
    });

    const buf = await wb.xlsx.writeBuffer();
    const fileName = `Monthly_Past_${new Date(0, month - 1).toLocaleString("en", {
      month: "short",
    })}_${year}.xlsx`;
    saveAsFn(new Blob([buf]), fileName);
  }

  const renderNotesPretty = (notesConcat: string) => {
    if (!notesConcat) return "—";
    const parts = notesConcat.split(", ").filter(Boolean);
    return (
      <div className="notes-list">
        {parts.map((p, idx) => {
          const [monthLabel, ...rest] = p.split(": ");
          const restText = rest.join(": ");
          return (
            <div className="note-line" key={idx}>
              <span className="note-month">{monthLabel}:</span>{" "}
              <span>{restText}</span>
            </div>
          );
        })}
      </div>
    );
  };

  useEffect(() => {
    loadCurrentTotals();
  }, []);

  return (
    <div className="mi-container">
      <h2 className="mi-title">Monthly Inventory</h2>

      {/* Filtros */}
      <div className="filters">
        <div className="field">
          <label className="label">Month</label>
          <select
            value={month}
            onChange={(e) => setMonth(Number(e.target.value))}
            className="select"
          >
            {Array.from({ length: 12 }, (_, i) => (
              <option key={i + 1} value={i + 1}>
                {new Date(0, i).toLocaleString("en", { month: "short" }).toUpperCase()}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label className="label">Year</label>
          <input
            type="number"
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            className="input w-28"
          />
        </div>
      </div>

      {/* ======= TABLA SUPERIOR ======= */}
      <div className="card">
        <div className="card-actions">
          <button className="btn btn-secondary" onClick={exportTopToExcel}>
            Export to Excel
          </button>
        </div>
        <table className="table">
          <thead>
            <tr>
              <th>Category / Item</th>
              <th>Item Number</th>
              <th className="right">Qty (Current)</th>
              <th className="right">Qty (Previous)</th>
              <th className="right">Δ (Item)</th>
              <th className="right">Δ (Category Total)</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="empty">
                  {loading ? "Loading..." : "No data to show."}
                </td>
              </tr>
            ) : (
              (() => {
                const groupedRows: JSX.Element[] = [];
                let lastCategory = "";

                for (let i = 0; i < rows.length; i++) {
                  const r = rows[i];

                  if (r.category_name !== lastCategory) {
                    lastCategory = r.category_name;
                    groupedRows.push(
                      <tr className="cat-row" key={`cat-${r.category_id}-${i}`}>
                        <td colSpan={7}>{r.category_name}</td>
                      </tr>
                    );
                  }

                  groupedRows.push(
                    <tr key={i} className={getColorClass(r.diff, r.qty_current_total)}>
                      <td className="pad-left">{r.item_name}</td>
                      <td className="center">{r.item_number || "—"}</td>
                      <td className="right">{r.qty_current_total}</td>
                      <td className="right">{r.qty_prev_total}</td>
                      <td className="right">{r.diff}</td>
                      <td className="right">{r.diff === 0 ? "—" : r.diff}</td>
                      <td>
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
                            className="input w-56"
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

      <div className="actions">
        <button
          disabled={!allNotesFilled}
          onClick={saveMonthlyInventory}
          className="btn btn-primary"
        >
          Save Monthly Inventory
        </button>
      </div>

      {/* ======= CONTROLES TABLA INFERIOR ======= */}
      <div className="past-controls">
        <label className="label-inline">Show last</label>
        <input
          type="number"
          min={1}
          max={11}
          value={pastCount}
          onChange={(e) => setPastCount(Number(e.target.value))}
          className="input w-20"
        />
        <span className="label-inline">inventories</span>
        <button onClick={makePastInventories} className="btn btn-secondary">
          Past Inventories
        </button>
      </div>

      {/* ======= TABLA INFERIOR ======= */}
      {pastGrouped.length > 0 && (
        <div className="card">
          <div className="card-actions">
            <button className="btn btn-secondary" onClick={exportBottomToExcel}>
              Export to Excel
            </button>
          </div>
          <table className="table">
            <thead>
              <tr>
                <th>Category / Item</th>
                <th>Item Number</th>
                <th className="right">Qty (Up to date)</th>
                {(pastColumns.length ? pastColumns : makePastCols(pastCount, month, year)).map(
                  (c) => (
                    <th key={`${c.year}-${c.month}`} className="right">
                      {c.label}
                    </th>
                  )
                )}
                <th>Grouped Notes</th>
              </tr>
            </thead>
            <tbody>
              {pastGrouped.map((grp, gi) => (
                <React.Fragment key={`grp-${grp.category_id}-${gi}`}>
                  <tr className="cat-row">
                    <td colSpan={2}>{grp.category_name}</td>
                    <td className="right"></td>
                    {(pastColumns.length ? pastColumns : makePastCols(pastCount, month, year)).map(
                      (_c, idx) => (
                        <td key={`c-${idx}`} className="right"></td>
                      )
                    )}
                    <td></td>
                  </tr>

                  {grp.items.map((it) => (
                    <tr key={`it-${grp.category_id}-${it.item_id}`}>
                      <td className="pad-left">{it.item_name}</td>
                      <td className="center">{it.item_number || "—"}</td>
                      <td className="right">{it.qty_current}</td>
                      {it.qty_by_col.map((q, qi) => (
                        <td key={`q-${qi}`} className="right">
                          {q}
                        </td>
                      ))}
                      <td>{renderNotesPretty(it.notes_concat)}</td>
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
