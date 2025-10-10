import React, { useEffect, useMemo, useState } from 'react'
import { supabase } from '../utils/supabase'
import * as XLSX from 'xlsx'

type User = { id:string, username:string, role:'super_admin'|'admin'|'standard', department_id:number|null }
type Dept = { id:number, name:string }
type ItemDeleted = {
  id:number
  name:string
  category_name:string
  area_name:string|null
  deleted_at:string
}

const Archived: React.FC<{user:User}> = ({user})=>{
  const [departments, setDepartments] = useState<Dept[]>([])
  const [selectedDept, setSelectedDept] = useState<number | ''>(
    user.role === 'super_admin' ? '' : (user.department_id ?? '')
  )

  const [month, setMonth] = useState<number | ''>('')   // 1–12 o ''
  const [year, setYear] = useState<number | ''>('')     // ej. 2025 o ''
  const [items, setItems] = useState<ItemDeleted[]>([])
  const [loading, setLoading] = useState(false)

  // ==== Cargar departamentos (solo super_admin) ====
  useEffect(()=>{ (async ()=>{
    if(user.role!=='super_admin') return
    const { data, error } = await supabase.from('departments').select('id,name').order('name')
    if(error){ alert(error.message); return }
    setDepartments(data||[])
  })() },[user.role])

  // ==== Cargar artículos eliminados (desde la vista archived_items) ====
  useEffect(()=>{ (async ()=>{
    if(user.role==='standard') return
    if(user.role==='super_admin' && !selectedDept) return

    setLoading(true)
    try{
      // Base query: vista ya creada por ti
      // Necesitamos department_id para filtrar en el servidor (mejor performance).
      // Si tu vista no tiene department_id, quita el .eq('department_id', ...) y
      // el filtrado se hará abajo por fecha y (si hace falta) por dept en cliente.
      let q = supabase
        .from('v_archived_items')
        .select('*') // la vista devuelve los campos; mapeamos abajo de forma robusta
        .not('deleted_at', 'is', null)

      // Filtro por departamento (server-side, si la vista lo expone)
      if(user.role === 'admin' && user.department_id){
        q = q.eq('department_id', user.department_id)
      } else if(user.role === 'super_admin' && selectedDept){
        q = q.eq('department_id', selectedDept)
      }

      // Filtro por mes/año (server-side si ambos están set)
      if (month && year){
        // build [from, to)
        const from = new Date(Number(year), Number(month)-1, 1)
        const to = new Date(from)
        to.setMonth(from.getMonth() + 1)

        const fromStr = from.toISOString()
        const toStr = to.toISOString()

        q = q.gte('deleted_at', fromStr).lt('deleted_at', toStr)
      }

      const { data, error } = await q
      if(error) throw error

      // Mapeo robusto: soporta item_id/id, item_name/name, etc.
      const rows: ItemDeleted[] = (data||[]).map((r:any)=>({
        id: Number(r.id ?? r.item_id),
        name: String(r.name ?? r.item_name ?? '—'),
        category_name: String(r.category_name ?? '—'),
        area_name: r.area_name ?? null,
        deleted_at: String(r.deleted_at)
      }))

      // Si solo vino uno de los filtros (mes o año), filtramos en cliente.
      let filtered = rows
      if ((month && !year) || (!month && year)) {
        filtered = rows.filter(rr=>{
          const d = new Date(rr.deleted_at)
          const m = d.getMonth() + 1
          const y = d.getFullYear()
          if (month && !year) return m === month
          if (year && !month) return y === year
          return true
        })
      }

      setItems(filtered)
    }catch(err:any){
      alert(err?.message || String(err))
    }finally{
      setLoading(false)
    }
  })() },[user.role, selectedDept, month, year, user.department_id])

  // ==== Agrupar por categoría ====
  const grouped = useMemo(()=>{
    const map: Record<string, ItemDeleted[]> = {}
    for(const it of items){
      const key = it.category_name || '—'
      if(!map[key]) map[key] = []
      map[key].push(it)
    }
    // Ordenar por nombre de categoría y por fecha dentro de cada grupo
    const sorted: Array<[string, ItemDeleted[]]> = Object.entries(map)
      .sort((a,b)=> a[0].localeCompare(b[0]))
      .map(([cat, rows])=> [cat, rows.sort((r1, r2)=> +new Date(r2.deleted_at) - +new Date(r1.deleted_at))] as [string,ItemDeleted[]])
    return Object.fromEntries(sorted)
  },[items])

  // ==== Exportar a Excel ====
  function exportToExcel(){
    if(!Object.keys(grouped).length){ alert('No data to export'); return }
    const wb = XLSX.utils.book_new()
    const allRows: any[] = []
    for(const [cat, rows] of Object.entries(grouped)){
      allRows.push([cat])
      allRows.push(['Item', 'Area', 'Deleted At'])
      rows.forEach(r=>{
        allRows.push([r.name, r.area_name||'—', new Date(r.deleted_at).toLocaleString()])
      })
      allRows.push([])
    }
    const ws = XLSX.utils.aoa_to_sheet(allRows)
    XLSX.utils.book_append_sheet(wb, ws, 'Archived')
    XLSX.writeFile(wb, 'archived_items.xlsx')
  }

  if(user.role==='standard'){
    return <div className="card"><h3>Access denied</h3><p>This view is for administrators only.</p></div>
  }

  return (
    <div className="card" style={{overflowX:'auto'}}>
      <h3 style={{marginTop:0}}>Archived Items</h3>

      {/* ====== Filtros ====== */}
      <div style={{display:'flex', flexWrap:'wrap', gap:12, marginBottom:16, alignItems:'center'}}>
        {user.role==='super_admin' && (
          <div className="field">
            <label>Department</label>
            <select className="select" value={selectedDept}
              onChange={e=>setSelectedDept(e.target.value?Number(e.target.value):'')}>
              <option value="">Select department</option>
              {departments.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
        )}

        <div className="field">
          <label>Month</label>
          <select className="select" value={month} onChange={e=>setMonth(e.target.value?Number(e.target.value):'')}>
            <option value="">All</option>
            {[...Array(12)].map((_,i)=><option key={i+1} value={i+1}>{i+1}</option>)}
          </select>
        </div>

        <div className="field">
          <label>Year</label>
          <input
            type="number"
            className="input"
            value={year}
            placeholder="All"
            onChange={e=>setYear(e.target.value?Number(e.target.value):'')}
            style={{width:100}}
          />
        </div>

        <button className="btn btn-primary" onClick={exportToExcel}>Export to Excel</button>
      </div>

      {/* ====== Tabla agrupada ====== */}
      {loading ? (
        <p>Loading...</p>
      ) : items.length===0 ? (
        <p style={{opacity:.7}}>No archived items found.</p>
      ) : (
        Object.entries(grouped).map(([cat, rows])=>(
          <div key={cat} style={{marginBottom:24}}>
            <h4 style={{marginBottom:8, borderBottom:'1px solid #ccc', paddingBottom:4}}>{cat}</h4>
            <table style={{width:'100%', borderCollapse:'collapse'}}>
              <thead>
                <tr style={{background:'#f8f8f8'}}>
                  <th style={{textAlign:'left', padding:'6px 8px'}}>Item</th>
                  <th style={{textAlign:'left', padding:'6px 8px'}}>Area</th>
                  <th style={{textAlign:'left', padding:'6px 8px'}}>Deleted at</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r=>(
                  <tr key={`${r.id}-${r.area_name ?? 'na'}`} style={{borderTop:'1px solid #eee'}}>
                    <td style={{padding:'6px 8px'}}>{r.name}</td>
                    <td style={{padding:'6px 8px'}}>{r.area_name||'—'}</td>
                    <td style={{padding:'6px 8px'}}>{new Date(r.deleted_at).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))
      )}
    </div>
  )
}

export default Archived
