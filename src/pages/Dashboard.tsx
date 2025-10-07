import React, { useEffect, useMemo, useState } from 'react'
import { supabase } from '../utils/supabase'
import {
  ResponsiveContainer,
  BarChart, Bar,
  LineChart, Line,
  PieChart, Pie, Cell,
  CartesianGrid, XAxis, YAxis, Tooltip, Legend,
} from 'recharts'

type User = { id:string, username:string, role:'super_admin'|'admin'|'standard', department_id:number|null }

type Dept = { id:number, name:string }

type KPI = {
  areas: number
  categories: number
  items: number
}

type QtyByMonthRow = {
  department_id: number
  year: number
  month: number
  item_id: number
  qty_total: number
}

type ItemRow = { id:number, name:string }

type RecUserRow = {
  username: string
  records_count: number
}

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const COLORS = ['#4CAF50','#2196F3','#FF9800','#9C27B0','#00BCD4','#FFC107','#E91E63','#8BC34A','#03A9F4','#FF5722']

/**
 * Dashboard
 * - Solo visible para admin / super_admin
 * - Si es super_admin: debe elegir el departamento para ver datos
 * - KPIs: #areas, #categorías, #items
 * - Gráfica 1 (barras apiladas): Qty de cada artículo por MES en el AÑO seleccionado (fuente monthly_inventories vía vista v_items_qty_by_month)
 * - Gráfica 2 (barras): Records por usuario en (mes, año) seleccionados (vista v_records_by_user_month)
 */
const Dashboard: React.FC<{ user: User }> = ({ user }) => {
  const isAdmin = user.role === 'admin' || user.role === 'super_admin'

  // --- Departamentos ---
  const [deps, setDeps] = useState<Dept[]>([])
  const [deptId, setDeptId] = useState<number | null>(user.role === 'admin' ? (user.department_id ?? null) : null)

  // --- KPI ---
  const [kpi, setKpi] = useState<KPI>({ areas:0, categories:0, items:0 })

  // --- Gráfica: Qty por artículo por meses (año seleccionado) ---
  const thisYear = new Date().getFullYear()
  const [yearQty, setYearQty] = useState<number>(thisYear)
  // topN para no saturar el gráfico (puedes subirlo si lo deseas)
  const [topN, setTopN] = useState<number>(5)
  const [seriesQty, setSeriesQty] = useState<any[]>([]) // cada fila => { monthLabel, [itemName] : qty, ... }
  const [legendItems, setLegendItems] = useState<string[]>([]) // nombres de items que están en el top y pintamos

  // --- Gráfica: Records por usuario (mes y año) ---
  const [selMonth, setSelMonth] = useState<number>(new Date().getMonth() + 1) // 1..12
  const [selYear, setSelYear] = useState<number>(thisYear)
  const [userRecordsData, setUserRecordsData] = useState<Array<{ name:string; count:number }>>([])

  // ============ Cargar departamentos para super_admin ============
  useEffect(() => {
    (async () => {
      if (user.role !== 'super_admin') return
      const { data, error } = await supabase.from('departments').select('id,name').order('id')
      if (error) { alert(error.message); return }
      setDeps(data || [])
      if (!deptId && data && data.length) setDeptId(data[0].id)
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ============ Disparar cargas cuando cambia deptId ============
  useEffect(() => {
    if (!deptId) return
    loadKPIs(deptId)
    loadQtyByMonth(deptId, yearQty, topN)
    loadRecordsByUser(deptId, selYear, selMonth)
  }, [deptId])

  // Re-cargas por cambos de filtros específicos
  useEffect(() => { if(deptId) loadQtyByMonth(deptId, yearQty, topN) }, [yearQty, topN])
  useEffect(() => { if(deptId) loadRecordsByUser(deptId, selYear, selMonth) }, [selYear, selMonth])

  // ======================= LOADERS =======================

  async function loadKPIs(currentDept: number){
    try{
      // areas
      const [{ count: areas }, { count: cats }, itemsRes] = await Promise.all([
        supabase.from('areas').select('id', { count:'exact', head:true }).eq('department_id', currentDept),
        supabase.from('categories').select('id', { count:'exact', head:true }).eq('department_id', currentDept),
        // items por categorías del depto (join manual, porque items no tiene depto directo)
        supabase
          .from('items')
          .select('id, category_id, categories!inner(id,department_id)', { count:'exact', head:true })
          .eq('categories.department_id', currentDept)
      ])

      setKpi({
        areas: areas || 0,
        categories: cats || 0,
        items: itemsRes.count || 0,
      })
    }catch(e:any){
      alert(e.message || String(e))
    }
  }

  /**
   * Carga los datos para el stacked-bar: cantidades por MES del AÑO dado,
   * tomando los TOP-N ítems del año (por suma total anual).
   * Vista: v_items_qty_by_month (department_id, year, month, item_id, qty_total)
   */
  async function loadQtyByMonth(currentDept: number, year: number, top: number){
    try{
      // 1) Traer filas del año seleccionado
      const { data, error } = await supabase
        .from('v_items_qty_by_month')
        .select('item_id,month,qty_total')
        .eq('department_id', currentDept)
        .eq('year', year)

      if(error) throw error
      const rows = (data || []) as QtyByMonthRow[]

      if(rows.length === 0){
        setSeriesQty([])
        setLegendItems([])
        return
      }

      // 2) Necesitamos nombres de los items
      const itemIds = Array.from(new Set(rows.map(r => r.item_id)))
      let itemNameById: Record<number,string> = {}
      if(itemIds.length){
        const { data: items } = await supabase
          .from('items')
          .select('id,name')
          .in('id', itemIds)
        itemNameById = Object.fromEntries((items || []).map((it:ItemRow) => [it.id, it.name]))
      }

      // 3) Sumar anual por item para escoger TOP-N
      const totalByItem = new Map<number, number>()
      for(const r of rows){
        totalByItem.set(r.item_id, (totalByItem.get(r.item_id) || 0) + Number(r.qty_total || 0))
      }
      const topItems = Array.from(totalByItem.entries())
        .sort((a,b) => b[1] - a[1])
        .slice(0, top)
        .map(([id]) => id)

      const legendNames = topItems.map(id => itemNameById[id] || `#${id}`)
      setLegendItems(legendNames)

      // 4) Armar matriz mes -> item -> qty (solo TOP items)
      const monthMap: Record<number, Record<string, number>> = {}
      for(const r of rows){
        if(!topItems.includes(r.item_id)) continue
        const m = r.month
        const itemName = itemNameById[r.item_id] || `#${r.item_id}`
        monthMap[m] = monthMap[m] || {}
        monthMap[m][itemName] = (monthMap[m][itemName] || 0) + Number(r.qty_total || 0)
      }

      // 5) Asegurar los 12 meses y 0s
      const finalRows = []
      for(let m=1; m<=12; m++){
        const row:any = { month: MONTHS[m-1] }
        for(const name of legendNames) row[name] = monthMap[m]?.[name] ?? 0
        finalRows.push(row)
      }
      setSeriesQty(finalRows)
    }catch(e:any){
      alert(e.message || String(e))
    }
  }

  /**
   * Carga los records por usuario para (año, mes) seleccionados
   * Vista: v_records_by_user_month
   */
  async function loadRecordsByUser(currentDept:number, year:number, month:number){
    try{
      const { data, error } = await supabase
        .from('v_records_by_user_month')
        .select('username,records_count')
        .eq('department_id', currentDept)
        .eq('year', year)
        .eq('month', month)
        .order('records_count', { ascending:false })

      if(error) throw error
      const rows = (data || []) as RecUserRow[]
      setUserRecordsData(rows.map(r => ({ name:r.username, count:r.records_count })))
    }catch(e:any){
      alert(e.message || String(e))
    }
  }

  // ======================= RENDER =======================

  if(!isAdmin){
    return (
      <div className="card">
        <h3 style={{marginTop:0}}>Dashboard</h3>
        <div style={{opacity:.8}}>Solo disponible para administradores.</div>
      </div>
    )
  }

  return (
    <div className="card">
      <h3 style={{marginTop:0}}>Dashboard</h3>

      {/* Selector de departamento (solo super_admin) */}
      {user.role === 'super_admin' && (
        <div className="card" style={{boxShadow:'none', padding:'12px', marginBottom:16}}>
          <div className="field" style={{maxWidth:360}}>
            <label>Department</label>
            <select
              className="select"
              value={deptId ?? ''}
              onChange={e => setDeptId(e.target.value === '' ? null : Number(e.target.value))}
            >
              {deps.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
        </div>
      )}

      {!deptId ? (
        <div style={{opacity:.8}}>Selecciona un departamento para ver datos.</div>
      ) : (
        <>
          {/* KPIs */}
          <section className="card" style={{display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(180px,1fr))', gap:12}}>
            <Kpi title="Areas" value={kpi.areas}/>
            <Kpi title="Categories" value={kpi.categories}/>
            <Kpi title="Items" value={kpi.items}/>
          </section>

          {/* FILA DE GRÁFICOS */}
          <section style={{display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(320px,1fr))', gap:12}}>

            {/* ====== Gráfica: Qty por artículo por meses (año) ====== */}
            <div className="card">
              <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', gap:12, flexWrap:'wrap', marginBottom:8}}>
                <h4 style={{margin:0}}>Qty por artículo (por mes)</h4>
                <div style={{display:'flex', gap:10, alignItems:'center', flexWrap:'wrap'}}>
                  <label style={{display:'flex', alignItems:'center', gap:6}}>
                    <span>Year</span>
                    <input className="input" style={{width:110}} type="number" value={yearQty} onChange={e=>setYearQty(Number(e.target.value))}/>
                  </label>
                  <label style={{display:'flex', alignItems:'center', gap:6}}>
                    <span>Top</span>
                    <input className="input" style={{width:80}} type="number" min={1} max={20} value={topN} onChange={e=>setTopN(Math.max(1, Math.min(20, Number(e.target.value))))}/>
                  </label>
                </div>
              </div>

              <div style={{width:'100%', height:340}}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={seriesQty} margin={{ top:10, right:20, left:0, bottom:0 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="month" />
                    <YAxis allowDecimals={false} />
                    <Tooltip />
                    <Legend />
                    {legendItems.map((name, idx) => (
                      <Bar key={name} dataKey={name} stackId="qty" fill={COLORS[idx % COLORS.length]} />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* ====== Gráfica: Records por usuario (mes, año) ====== */}
            <div className="card">
              <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', gap:12, flexWrap:'wrap', marginBottom:8}}>
                <h4 style={{margin:0}}>Records por usuario (mes seleccionado)</h4>
                <div style={{display:'flex', gap:10, alignItems:'center', flexWrap:'wrap'}}>
                  <label style={{display:'flex', alignItems:'center', gap:6}}>
                    <span>Month</span>
                    <select className="select" value={selMonth} onChange={e=>setSelMonth(Number(e.target.value))}>
                      {MONTHS.map((m, i)=>(<option key={i+1} value={i+1}>{m}</option>))}
                    </select>
                  </label>
                  <label style={{display:'flex', alignItems:'center', gap:6}}>
                    <span>Year</span>
                    <input className="input" style={{width:110}} type="number" value={selYear} onChange={e=>setSelYear(Number(e.target.value))}/>
                  </label>
                </div>
              </div>

              <div style={{width:'100%', height:340}}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={userRecordsData} margin={{ top:10, right:20, left:0, bottom:0 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" />
                    <YAxis allowDecimals={false} />
                    <Tooltip />
                    <Legend />
                    <Bar dataKey="count" name="Records" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              {userRecordsData.length === 0 && <div style={{opacity:.7, marginTop:6}}>No hay registros para ese mes/año.</div>}
            </div>

          </section>
        </>
      )}
    </div>
  )
}

const Kpi: React.FC<{ title:string, value:number|string }> = ({ title, value }) => {
  return (
    <div className="card" style={{textAlign:'center', padding:'16px'}}>
      <div style={{fontSize:12, opacity:.7, marginBottom:6}}>{title}</div>
      <div style={{fontSize:28, fontWeight:700}}>{value}</div>
    </div>
  )
}

export default Dashboard
