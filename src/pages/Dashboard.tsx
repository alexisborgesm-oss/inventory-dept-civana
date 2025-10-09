import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "../utils/supabase";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  BarChart,
  Bar,
} from "recharts";

type Role = "super_admin" | "admin" | "standard";
type User = { id: string; username: string; role: Role; department_id: number | null };

type Dept = { id: number; name: string };
type Area = { id: number; name: string; department_id: number };
type Category = { id: number; name: string; department_id: number | null; tagged?: boolean };
type Item = {
  id: number;
  name: string;
  category_id: number;
  unit?: string | null;
  vendor?: string | null;
  article_number?: string | null;
  is_valuable?: boolean | null;
};
type Threshold = { area_id: number; item_id: number; expected_qty: number };
type MonthlyInv = {
  id: number;
  department_id: number;
  month: number;
  year: number;
  item_id: number | null;
  qty_total: number;
};
type RecordRow = { id: number; area_id: number; inventory_date: string; created_at: string };

const monthShort = (m: number) =>
  new Date(2000, m - 1, 1).toLocaleString("en", { month: "short" });

const MONTHS = [
  { v: 1, n: "Jan" }, { v: 2, n: "Feb" }, { v: 3, n: "Mar" }, { v: 4, n: "Apr" },
  { v: 5, n: "May" }, { v: 6, n: "Jun" }, { v: 7, n: "Jul" }, { v: 8, n: "Aug" },
  { v: 9, n: "Sep" }, { v: 10, n: "Oct" }, { v: 11, n: "Nov" }, { v: 12, n: "Dec" },
];

const Dashboard: React.FC<{ user: User }> = ({ user }) => {
  const isSA = user.role === "super_admin";
  const [departments, setDepartments] = useState<Dept[]>([]);
  const [deptId, setDeptId] = useState<number | null>(
    isSA ? null : user.department_id ?? null
  );

  // domain data
  const [areas, setAreas] = useState<Area[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [records, setRecords] = useState<RecordRow[]>([]);
  const [thresholds, setThresholds] = useState<Threshold[]>([]);
  const [mnlys, setMnlys] = useState<MonthlyInv[]>([]);

  // UI
  const [loading, setLoading] = useState(false);
  const [itemForSeries, setItemForSeries] = useState<number | "">("");

  // Selectores de mes/año (compartidos por 2 gráficas de barras)
  const now = new Date();
  const [selMonth, setSelMonth] = useState<number>(now.getMonth() + 1);
  const [selYear, setSelYear] = useState<number>(now.getFullYear());

  // Records por usuario (mes/año)
  const [userRecData, setUserRecData] = useState<Array<{ name: string; count: number }>>([]);

  // NUEVO: Records por área (mes/año)
  const [areaRecData, setAreaRecData] = useState<Array<{ name: string; count: number }>>([]);

  // ===== Load departments (only super_admin) =====
  useEffect(() => {
    if (!isSA) return;
    (async () => {
      const { data, error } = await supabase
        .from("departments")
        .select("id,name")
        .order("id");
      if (error) { alert(error.message); return; }
      setDepartments(data || []);
    })();
  }, [isSA]);

  // ===== Load all needed data when dept changes =====
  useEffect(() => {
    if (!deptId) return;
    setLoading(true);
    (async () => {
      try {
        const [{ data: a }, { data: c }, { data: it }, { data: rec }, { data: thr }, { data: mi }] =
          await Promise.all([
            supabase
              .from("areas")
              .select("id,name,department_id")
              .eq("department_id", deptId),
            supabase
              .from("categories")
              .select("id,name,department_id,tagged")
              .eq("department_id", deptId),
            supabase
              .from("items")
              .select("id,name,category_id,unit,vendor,article_number,is_valuable")
              .in(
                "category_id",
                (
                  (
                    await supabase
                      .from("categories")
                      .select("id")
                      .eq("department_id", deptId)
                  ).data || []
                ).map((r: any) => r.id)
              ),
            supabase
              .from("records")
              .select("id,area_id,inventory_date,created_at")
              .in(
                "area_id",
                (
                  (
                    await supabase
                      .from("areas")
                      .select("id")
                      .eq("department_id", deptId)
                  ).data || []
                ).map((r: any) => r.id)
              )
              .order("created_at", { ascending: false }),
            supabase
              .from("thresholds")
              .select("area_id,item_id,expected_qty")
              .in(
                "area_id",
                (
                  (
                    await supabase
                      .from("areas")
                      .select("id")
                      .eq("department_id", deptId)
                  ).data || []
                ).map((r: any) => r.id)
              ),
            supabase
              .from("monthly_inventories")
              .select("id,department_id,month,year,item_id,qty_total")
              .eq("department_id", deptId),
          ]);

        setAreas(a || []);
        setCategories(c || []);
        setItems(it || []);
        setRecords(rec || []);
        setThresholds(thr || []);
        setMnlys(mi || []);

        if (!itemForSeries) {
          const first = (it || [])[0]?.id ?? "";
          setItemForSeries(first || "");
        }
      } finally {
        setLoading(false);
      }
    })();
  }, [deptId]); // eslint-disable-line

  // ====== Records por usuario (vista v_records_by_user_month) ======
  useEffect(() => {
    if (!deptId) return;
    (async function loadRecordsByUser() {
      const { data, error } = await supabase
        .from("v_records_by_user_month")
        .select("username,records_count")
        .eq("department_id", deptId)
        .eq("year", selYear)
        .eq("month", selMonth)
        .order("records_count", { ascending: false });

      if (error) { alert(error.message); return; }
      setUserRecData((data || []).map((r: any) => ({ name: r.username, count: r.records_count })));
    })();
  }, [deptId, selYear, selMonth]);

  // ====== NUEVO: Records por área (vista v_records_by_area_month) ======
  useEffect(() => {
    if (!deptId) return;
    (async function loadRecordsByArea() {
      const { data, error } = await supabase
        .from("v_records_by_area_month")
        .select("area_name,records_count")
        .eq("department_id", deptId)
        .eq("year", selYear)
        .eq("month", selMonth)
        .order("records_count", { ascending: false });

      if (error) { alert(error.message); return; }
      setAreaRecData((data || []).map((r: any) => ({ name: r.area_name, count: r.records_count })));
    })();
  }, [deptId, selYear, selMonth]);

  // ====== KPIs ======
  const KPI = useMemo(() => {
    const kAreas = areas.length;
    const kCats = categories.length;
    const kItems = items.length;

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 30);
    const last30 = records.filter((r) => new Date(r.created_at) >= cutoff).length;

    const lastDate =
      records.length > 0
        ? new Date(
            [...records].sort(
              (a, b) => +new Date(b.created_at) - +new Date(a.created_at)
            )[0].created_at
          )
        : null;

    return {
      areas: kAreas,
      categories: kCats,
      items: kItems,
      last30,
      lastDateLabel: lastDate
        ? `${lastDate.toLocaleDateString()} ${lastDate.toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })}`
        : "—",
    };
  }, [areas, categories, items, records]);

  // ====== Actividad por mes (últimos 6 meses) ======
  const activitySeries = useMemo(() => {
    const map = new Map<string, number>();
    records.forEach((r) => {
      const d = new Date(r.created_at);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      map.set(key, (map.get(key) || 0) + 1);
    });

    const res: Array<{ label: string; count: number }> = [];
    const today = new Date();
    let m = today.getMonth() + 1;
    let y = today.getFullYear();
    for (let i = 0; i < 6; i++) {
      const key = `${y}-${String(m).padStart(2, "0")}`;
      const label = `${monthShort(m)} ${String(y).slice(2)}`;
      res.unshift({ label, count: map.get(key) || 0 });
      m = m === 1 ? 12 : m - 1;
      if (m === 12) y -= 1;
    }
    return res;
  }, [records]);

  // ====== Low stock (último monthly vs thresholds) ======
  const lowStockRows = useMemo(() => {
    if (!mnlys.length || !thresholds.length) return [];
    const sorted = [...mnlys].sort((a, b) =>
      a.year !== b.year ? b.year - a.year : b.month - a.month
    );
    const latestY = sorted[0]?.year;
    const latestM = sorted[0]?.month;
    if (!latestY || !latestM) return [];

    const totalByItem = new Map<number, number>();
    sorted
      .filter((r) => r.year === latestY && r.month === latestM && r.item_id)
      .forEach((r) => {
        const iid = r.item_id as number;
        totalByItem.set(iid, (totalByItem.get(iid) || 0) + Number(r.qty_total || 0));
      });

    const expectedByItem = new Map<number, number>();
    thresholds.forEach((t) => {
      expectedByItem.set(
        t.item_id,
        (expectedByItem.get(t.item_id) || 0) + Number(t.expected_qty || 0)
      );
    });

    const rows = Array.from(expectedByItem.entries())
      .map(([item_id, expected]) => {
        const current = totalByItem.get(item_id) || 0;
        return { item_id, expected, current, deficit: current - expected };
      })
      .filter((r) => r.current < r.expected)
      .sort((a, b) => a.deficit - b.deficit)
      .slice(0, 20);

    return rows.map((r) => ({
      ...r,
      item_name: items.find((it) => it.id === r.item_id)?.name || `#${r.item_id}`,
    }));
  }, [mnlys, thresholds, items]);

  // ====== Serie mensual por artículo (últimos 12 meses) ======
  const itemQtySeries = useMemo(() => {
    if (!deptId || !itemForSeries || !mnlys.length) return [];
    const res: Array<{ label: string; qty: number; y: number; m: number }> = [];
    const today = new Date();
    let m = today.getMonth() + 1;
    let y = today.getFullYear();
    for (let i = 0; i < 12; i++) {
      res.unshift({ label: `${monthShort(m)} ${String(y).slice(2)}`, qty: 0, y, m });
      m = m === 1 ? 12 : m - 1;
      if (m === 12) y -= 1;
    }
    const map = new Map<string, number>();
    mnlys
      .filter((r) => r.department_id === deptId && r.item_id === (itemForSeries as number))
      .forEach((r) => {
        const key = `${r.year}-${String(r.month).padStart(2, "0")}`;
        map.set(key, (map.get(key) || 0) + Number(r.qty_total || 0));
      });
    return res.map((row) => {
      const key = `${row.y}-${String(row.m).padStart(2, "0")}`;
      return { label: row.label, qty: map.get(key) || 0 };
    });
  }, [deptId, itemForSeries, mnlys]);

  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>Dashboard</h3>

      {user.role === "super_admin" && (
        <div className="card" style={{ boxShadow: "none" }}>
          <div className="field">
            <label>Department</label>
            <select
              className="select"
              value={deptId ?? ""}
              onChange={(e) => setDeptId(e.target.value ? Number(e.target.value) : null)}
            >
              <option value="">Select a department</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name} (#{d.id})
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      {!deptId ? (
        <div style={{ opacity: 0.8 }}>Choose a department to see data.</div>
      ) : (
        <>
          {/* KPIs */}
          <div
            className="card"
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))",
              gap: 12,
            }}
          >
            <Kpi title="Areas" value={KPI.areas} />
            <Kpi title="Categories" value={KPI.categories} />
            <Kpi title="Items" value={KPI.items} />
            <Kpi title="Records (last 30d)" value={KPI.last30} />
            <Kpi title="Last saved" value={KPI.lastDateLabel} />
          </div>

          {/* Actividad mensual (últimos 6 meses) */}
          <div className="card">
            <h4 style={{ marginTop: 0 }}>Activity (records per month)</h4>
            <div style={{ width: "100%", height: 280 }}>
              <ResponsiveContainer>
                <LineChart data={activitySeries}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="label" />
                  <YAxis allowDecimals={false} />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="count" name="Records" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Low stock table */}
          <div className="card">
            <h4 style={{ marginTop: 0 }}>
              Low stock (latest Monthly Inventory vs thresholds)
            </h4>
            {loading ? (
              <div style={{ opacity: 0.75 }}>Loading…</div>
            ) : lowStockRows.length === 0 ? (
              <div style={{ opacity: 0.8 }}>No items under expected levels.</div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table>
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th className="right">Current</th>
                      <th className="right">Expected</th>
                      <th className="right">Deficit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lowStockRows.map((r, i) => (
                      <tr key={i}>
                        <td>{r.item_name}</td>
                        <td className="right">{r.current}</td>
                        <td className="right">{r.expected}</td>
                        <td
                          className="right"
                          style={{ color: "#d32f2f", fontWeight: 600 }}
                        >
                          {r.deficit}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Serie mensual por artículo */}
          <div className="card">
            <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
              <h4 style={{ margin: 0, flex: "0 0 auto" }}>Monthly quantities by item</h4>
              <div className="field" style={{ margin: 0, minWidth: 220 }}>
                <label>Item</label>
                <select
                  className="select"
                  value={itemForSeries}
                  onChange={(e) =>
                    setItemForSeries(e.target.value ? Number(e.target.value) : "")
                  }
                >
                  {items.map((it) => (
                    <option key={it.id} value={it.id}>
                      {it.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div style={{ width: "100%", height: 320, marginTop: 12 }}>
              <ResponsiveContainer>
                <BarChart data={itemQtySeries}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="label" />
                  <YAxis allowDecimals={false} />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="qty" name="Qty" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Records por usuario (mes/año) */}
          <div className="card">
            <div
              style={{
                display: "flex",
                gap: 12,
                alignItems: "center",
                flexWrap: "wrap",
                marginBottom: 8,
              }}
            >
              <h4 style={{ margin: 0, flex: "1 1 auto" }}>
                Records per user (selected month)
              </h4>

              <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span>Month</span>
                <select
                  className="select"
                  value={selMonth}
                  onChange={(e) => setSelMonth(Number(e.target.value))}
                >
                  {MONTHS.map((m) => (
                    <option key={m.v} value={m.v}>
                      {m.n}
                    </option>
                  ))}
                </select>
              </label>

              <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span>Year</span>
                <input
                  className="input"
                  type="number"
                  min={2000}
                  max={9999}
                  value={selYear}
                  onChange={(e) => setSelYear(Number(e.target.value))}
                  style={{ width: 110 }}
                />
              </label>
            </div>

            <div style={{ width: "100%", height: 320 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={userRecData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" />
                  <YAxis allowDecimals={false} />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="count" name="Records" />
                </BarChart>
              </ResponsiveContainer>
            </div>
            {userRecData.length === 0 && (
              <div style={{ opacity: 0.7, marginTop: 6 }}>No records for this month/year.</div>
            )}
          </div>

          {/* NUEVO: Records por área (mes/año) */}
          <div className="card">
            <h4 style={{ marginTop: 0 }}>Records per area (selected month)</h4>
            <div style={{ width: "100%", height: 320 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={areaRecData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" />
                  <YAxis allowDecimals={false} />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="count" name="Records" />
                </BarChart>
              </ResponsiveContainer>
            </div>
            {areaRecData.length === 0 && (
              <div style={{ opacity: 0.7, marginTop: 6 }}>No records for this month/year.</div>
            )}
          </div>
        </>
      )}
    </div>
  );
};

const Kpi: React.FC<{ title: string; value: string | number }> = ({ title, value }) => (
  <div
    className="card"
    style={{
      boxShadow: "var(--shadow)",
      margin: 0,
      display: "flex",
      flexDirection: "column",
      gap: 6,
    }}
  >
    <div style={{ opacity: 0.7, fontSize: 13, letterSpacing: 0.2 }}>{title}</div>
    <div style={{ fontWeight: 700, fontSize: 22 }}>{value}</div>
  </div>
);

export default Dashboard;
