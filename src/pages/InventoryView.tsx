import React, { useEffect, useMemo, useState } from 'react'
import { supabase } from '../utils/supabase'

type User = { id:string, username:string, role:'super_admin'|'admin'|'standard', department_id:number|null }
type Dept = { id:number, name:string }
type Row = { area:string, category:string, item:string, unit?:string|null, vendor?:string|null, qty:number }

const InventoryView: React.FC<{user:User}> = ({user})=>{
  const [deptId, setDeptId] = useState<number | ''>(user.role==='super_admin' ? '' : (user.department_id || ''))
  const [departments, setDepartments] = useState<Dept[]>([])
  const [rows, setRows] = useState<Row[]>([])
  const [areas, setAreas] = useState<string[]>([])
  const [cats, setCats] = useState<string[]>([])
  const [areaFilter, setAreaFilter] = useState<string>('all')     // 'all' | 'no-areas' | <area name>
  const [catFilter, setCatFilter] = useState<string>('all')

  // (mantenemos estos estados aunque ya no usamos orden interactivo, por compatibilidad)
  const [_sortKey] = useState<keyof Row>('item')
  const [_asc] = useState(true)

  useEffect(()=>{
    if(user.role==='super_admin'){
      supabase.from('departments').select('*').then(({data})=> setDepartments(data||[]))
    }
  },[user.role])

  useEffect(()=>{
    const effectiveDept = user.role==='super_admin' ? deptId : user.department_id
    if(!effectiveDept) return
    supabase.rpc('inventory_matrix', { p_department_id: effectiveDept })
    .then(({data, error})=>{
      if(error){ alert(error.message); return }
      setRows(data||[])
      const areas = Array.from(new Set((data || []).map((r: any) => String(r.area)))) as string[]
      const cats  = Array.from(new Set((data || []).map((r: any) => String(r.category)))) as string[]
      setAreas(areas); setCats(cats)
    })
  },[deptId, user.department_id, user.role])

  // Visible (filtros + agregación "No Areas")
  const visible = useMemo(()=>{
    let r = rows

    // Filtro por categoría
    if(catFilter!=='all') r = r.filter(x=>x.category===catFilter)

    // Filtro por área normal
    if(areaFilter!=='all' && areaFilter!=='no-areas'){
      r = r.filter(x=>x.area===areaFilter)
    }

    // Orden lógico: categoría > item > vendor > área
    r = [...r].sort((a,b)=>{
      const c = a.category.localeCompare(b.category)
      if(c!==0) return c
      const i = a.item.localeCompare(b.item)
      if(i!==0) return i
      const v = (a.vendor||'').localeCompare(b.vendor||'')
      if(v!==0) return v
      return a.area.localeCompare(b.area)
    })

    // Modo "No Areas": agregamos por (category, item, vendor) sumando qty y sin área
    if(areaFilter==='no-areas'){
      const agg = new Map<string, Row>()
      for(const row of r){
        const key = `${row.category}||${row.item}||${row.vendor||''}`
        const prev = agg.get(key)
        if(prev){
          prev.qty += row.qty
        }else{
          agg.set(key, { area:'', category:row.category, item:row.item, vendor:row.vendor||'', qty:row.qty, unit:null })
        }
      }
      r = Array.from(agg.values()).sort((a,b)=>{
        const c = a.category.localeCompare(b.category)
        if(c!==0) return c
        const i = a.item.localeCompare(b.item)
        if(i!==0) return i
        return (a.vendor||'').localeCompare(b.vendor||'')
      })
    }

    return r
  },[rows, areaFilter, catFilter])

  // Agrupar por categoría para pintar encabezados de bloque
  const groupedByCategory = useMemo(()=>{
    const map = new Map<string, Row[]>()
    for(const row of visible){
      if(!map.has(row.category)) map.set(row.category, [])
      map.get(row.category)!.push(row)
    }
    return map
  },[visible])

  const colCount = areaFilter==='no-areas' ? 3 : 4 // Vendor, Item, [Area?], Qty

  return (
    <div>
      <div className="card">
        <h3 style={{marginTop:0}}>Inventory</h3>
        <div style={{display:'flex', gap:12, flexWrap:'wrap'}}>
          {user.role==='super_admin' && (
            <select className="select" value={deptId} onChange={e=> setDeptId(e.target.value?Number(e.target.value):'')}>
              <option value="">Select department</option>
              {departments.map(d=> <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          )}
          <select className="select" value={areaFilter} onChange={e=> setAreaFilter(e.target.value)}>
            <option value="all">All areas</option>
            <option value="no-areas">No Areas (Totals)</option>
            {areas.map(a=> <option key={a} value={a}>{a}</option>)}
          </select>
          <select className="select" value={catFilter} onChange={e=> setCatFilter(e.target.value)}>
            <option value="all">All categories</option>
            {cats.map(c=> <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      </div>

      <div className="card">
        <table>
          <thead>
            <tr>
              <th>Vendor</th>
              <th>Item</th>
              {areaFilter!=='no-areas' && <th>Area</th>}
              <th>{areaFilter==='no-areas' ? 'Total' : 'Qty'}</th>
            </tr>
          </thead>
          <tbody>
            {Array.from(groupedByCategory.keys()).map(cat=>{
              const rowsInCat = groupedByCategory.get(cat) || []
              return (
                <React.Fragment key={cat}>
                  {/* Fila de categoría, ocupando todas las columnas */}
                  <tr>
                    <td colSpan={colCount}
                        style={{
                          background:'#e9f0fb',
                          fontWeight:600,
                          borderTop:'1px solid #d1d9e6',
                          borderBottom:'1px solid #d1d9e6'
                        }}>
                      {cat}
                    </td>
                  </tr>
                  {/* Filas de items */}
                  {rowsInCat.map((r,i)=>(
                    <tr key={`${cat}-${i}`}>
                      <td>{r.vendor || ''}</td>
                      <td>{r.item}</td>
                      {areaFilter!=='no-areas' && <td>{r.area}</td>}
                      <td>{r.qty}</td>
                    </tr>
                  ))}
                </React.Fragment>
              )
            })}
            {/* Sin datos */}
            {groupedByCategory.size===0 && (
              <tr><td colSpan={colCount} style={{opacity:.7, padding:'12px 4px'}}>No data</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
export default InventoryView
