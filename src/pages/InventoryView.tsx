import React, { useEffect, useMemo, useState } from 'react'
import { supabase } from '../utils/supabase'

type User = { id:string, username:string, role:'super_admin'|'admin'|'standard', department_id:number|null }
type Dept = { id:number, name:string }
type Row = {
  area: string
  category: string
  item: string
  unit?: string | null
  vendor?: string | null
  qty: number
  article_number?: string | null
}

const InventoryView: React.FC<{user:User}> = ({user})=>{
  const [deptId, setDeptId] = useState<number | ''>(user.role==='super_admin' ? '' : (user.department_id || ''))
  const [departments, setDepartments] = useState<Dept[]>([])
  const [rows, setRows] = useState<Row[]>([])
  const [areas, setAreas] = useState<string[]>([])
  const [cats, setCats] = useState<string[]>([])
  const [areaFilter, setAreaFilter] = useState<string>('all')     // 'all' | 'no-areas' | <area name>
  const [catFilter, setCatFilter] = useState<string>('all')

  // Mapa (name+vendor) -> article_number
  const [itemNumMap, setItemNumMap] = useState<Map<string, string>>(new Map())

  useEffect(()=>{
    if(user.role==='super_admin'){
      supabase.from('departments').select('*').then(({data})=> setDepartments(data||[]))
    }
  },[user.role])

  useEffect(()=>{
    const effectiveDept = user.role==='super_admin' ? deptId : user.department_id
    if(!effectiveDept) return

    ;(async ()=>{
      // 1) Traer matriz de inventario
      const { data, error } = await supabase.rpc('inventory_matrix', { p_department_id: effectiveDept })
      if(error){ alert(error.message); return }

      // 2) Traer item numbers (de toda la tabla; coste bajo y evita tocar tu RPC)
      const { data: itemsFlags, error: e2 } = await supabase
        .from('items_with_flags')
        .select('name,vendor,article_number')
      if(e2){ alert(e2.message); return }

      const norm = (s:string|nil)=> (s??'').toString().trim().toLowerCase()
      type nil = string | null | undefined

      const map = new Map<string,string>()
      for(const it of (itemsFlags||[])){
        const key = `${norm(it.name)}||${norm(it.vendor)}`
        if(it.article_number) map.set(key, String(it.article_number))
      }
      setItemNumMap(map)

      // 3) Enriquecer filas con article_number
      const enriched: Row[] = (data||[]).map((r: any)=> {
        const key = `${norm(r.item)}||${norm(r.vendor)}`
        const art = map.get(key) || null
        return { ...r, article_number: art }
      })

      setRows(enriched)
      const areasSet = Array.from(new Set((enriched || []).map((r) => String(r.area)))) as string[]
      const catsSet  = Array.from(new Set((enriched || []).map((r) => String(r.category)))) as string[]
      setAreas(areasSet); setCats(catsSet)
    })()
  },[deptId, user.department_id, user.role])

  const visible = useMemo(()=>{
    let r = rows

    if(catFilter!=='all') r = r.filter(x=>x.category===catFilter)
    if(areaFilter!=='all' && areaFilter!=='no-areas'){
      r = r.filter(x=>x.area===areaFilter)
    }

    // Orden lógico: categoría > item > vendor > item_number > área
    r = [...r].sort((a,b)=>{
      const c = a.category.localeCompare(b.category); if(c!==0) return c
      const i = a.item.localeCompare(b.item); if(i!==0) return i
      const v = (a.vendor||'').localeCompare(b.vendor||''); if(v!==0) return v
      const an = (a.article_number||'').localeCompare(b.article_number||''); if(an!==0) return an
      return a.area.localeCompare(b.area)
    })

    if(areaFilter==='no-areas'){
      // Agregar por (category, item, vendor, article_number)
      const agg = new Map<string, Row>()
      for(const row of r){
        const key = `${row.category}||${row.item}||${row.vendor||''}||${row.article_number||''}`
        const prev = agg.get(key)
        if(prev){
          prev.qty += row.qty
        }else{
          agg.set(key, {
            area: '',
            category: row.category,
            item: row.item,
            vendor: row.vendor||'',
            qty: row.qty,
            unit: null,
            article_number: row.article_number || null,
          })
        }
      }
      r = Array.from(agg.values()).sort((a,b)=>{
        const c = a.category.localeCompare(b.category); if(c!==0) return c
        const i = a.item.localeCompare(b.item); if(i!==0) return i
        const v = (a.vendor||'').localeCompare(b.vendor||''); if(v!==0) return v
        return (a.article_number||'').localeCompare(b.article_number||'')
      })
    }

    return r
  },[rows, areaFilter, catFilter])

  // Agrupado por categoría
  const groupedByCategory = useMemo(()=>{
    const map = new Map<string, Row[]>()
    for(const row of visible){
      if(!map.has(row.category)) map.set(row.category, [])
      map.get(row.category)!.push(row)
    }
    return map
  },[visible])

  // Columnas: Vendor | Item | Item number | [Area?] | Qty/Total
  const colCount = areaFilter==='no-areas' ? 4 : 5

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
              <th>Item number</th>
              {areaFilter!=='no-areas' && <th>Area</th>}
              <th>{areaFilter==='no-areas' ? 'Total' : 'Qty'}</th>
            </tr>
          </thead>
          <tbody>
            {Array.from(groupedByCategory.keys()).map(cat=>{
              const rowsInCat = groupedByCategory.get(cat) || []
              return (
                <React.Fragment key={cat}>
                  {/* Encabezado de categoría */}
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
                      <td>{r.article_number || ''}</td>
                      {areaFilter!=='no-areas' && <td>{r.area}</td>}
                      <td>{r.qty}</td>
                    </tr>
                  ))}
                </React.Fragment>
              )
            })}
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
