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
      // 1) Matriz de inventario por departamento
      const { data, error } = await supabase.rpc('inventory_matrix', { p_department_id: effectiveDept })
      if(error){ alert(error.message); return }

      // 2) Item numbers (no tocamos tu RPC)
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

  // --- Preparar datos visibles y pivotados ---
  type PivotRow = {
    category: string
    vendor: string
    item: string
    article_number: string | null
    areas: Record<string, number> // sumas por área
    total: number                 // suma de todas las áreas
  }

  const { displayedAreas, groupedByCategory, colCount } = useMemo(()=>{
    // 1) Filtrar por categoría
    let base = rows
    if(catFilter !== 'all') base = base.filter(r => r.category === catFilter)

    // 2) Armar lista de áreas a mostrar según filtro de áreas
    const allAreas = Array.from(new Set(base.map(r => r.area))).sort((a,b)=>a.localeCompare(b))
    let showAreas: string[] = []
    if (areaFilter === 'all') showAreas = allAreas
    else if (areaFilter === 'no-areas') showAreas = []
    else showAreas = allAreas.filter(a => a === areaFilter)

    // 3) Construir pivote: llave por (category, vendor, item, article_number)
    const keyOf = (r:Row) => `${r.category}||${r.vendor||''}||${r.item}||${r.article_number||''}`

    const map = new Map<string, PivotRow>()
    for (const r of base) {
      const k = keyOf(r)
      let acc = map.get(k)
      if (!acc) {
        acc = {
          category: r.category,
          vendor: r.vendor || '',
          item: r.item,
          article_number: r.article_number || null,
          areas: {},
          total: 0
        }
        map.set(k, acc)
      }
      acc.areas[r.area] = (acc.areas[r.area] || 0) + (Number(r.qty) || 0)
      acc.total += (Number(r.qty) || 0)
    }

    // 4) Ordenar por categoría > item > vendor > item_number
    const pivotRows = Array.from(map.values()).sort((a,b)=>{
      const c = a.category.localeCompare(b.category); if(c!==0) return c
      const i = a.item.localeCompare(b.item); if(i!==0) return i
      const v = a.vendor.localeCompare(b.vendor); if(v!==0) return v
      return (a.article_number||'').localeCompare(b.article_number||'')
    })

    // 5) Agrupar por categoría
    const grouped = new Map<string, PivotRow[]>()
    for (const pr of pivotRows) {
      if (!grouped.has(pr.category)) grouped.set(pr.category, [])
      grouped.get(pr.category)!.push(pr)
    }

    // 6) Columnas: Vendor | Item | Item number | [Áreas*] | Total
    const cols = 3 /*vendor,item,item#*/ + showAreas.length + 1 /*total*/

    return { displayedAreas: showAreas, groupedByCategory: grouped, colCount: cols }
  }, [rows, catFilter, areaFilter])

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
            {areas.sort((a,b)=>a.localeCompare(b)).map(a=> <option key={a} value={a}>{a}</option>)}
          </select>
          <select className="select" value={catFilter} onChange={e=> setCatFilter(e.target.value)}>
            <option value="all">All categories</option>
            {cats.sort((a,b)=>a.localeCompare(b)).map(c=> <option key={c} value={c}>{c}</option>)}
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
              {displayedAreas.map(a => <th key={`h-${a}`}>{a}</th>)}
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            {Array.from(groupedByCategory.keys()).map(cat=>{
              const itemsInCat = groupedByCategory.get(cat) || []
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

                  {/* Filas de ítems pivotadas por área */}
                  {itemsInCat.map((pr, idx)=>(
                    <tr key={`${cat}-${idx}`}>
                      <td>{pr.vendor}</td>
                      <td>{pr.item}</td>
                      <td>{pr.article_number || ''}</td>
                      {displayedAreas.map(a=>{
                        const q = pr.areas[a] || 0
                        // Mostrar vacío si 0 (estilo hoja)
                        return <td key={`${cat}-${idx}-${a}`}>{q>0 ? q : ''}</td>
                      })}
                      <td>{pr.total}</td>
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
