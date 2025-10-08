import React, { useEffect, useMemo, useRef, useState } from 'react'
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

  // ==== datos extra para la tabla comparativa (qty vs threshold) ====
  const [areaIdByName, setAreaIdByName] = useState<Record<string, number>>({})
  const [areaNameById, setAreaNameById]   = useState<Record<number, string>>({})
  const [thRaw, setThRaw] = useState<Array<{area_id:number,item_id:number,expected_qty:number}>>([])
  const [itemInfoById, setItemInfoById] = useState<Record<number, {name:string, vendor:string|null, article_number:string|null, category_id:number}>>({})
  const [catNameById, setCatNameById] = useState<Record<number, string>>({})

  // multi-select de áreas para la tabla comparativa
  const [compareAreas, setCompareAreas] = useState<Set<string>>(new Set())
  const [areasDropdownOpen, setAreasDropdownOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // (name+vendor) -> article_number (para enriquecer matriz base sin tocar tu RPC)
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
      // 0) Áreas del departamento (con ids y nombres)
      const { data: areaObjs, error: eAreas } = await supabase
        .from('areas')
        .select('id,name')
        .eq('department_id', effectiveDept)
        .order('name', { ascending: true })
      if(eAreas){ alert(eAreas.message); return }
      const idsByName: Record<string, number> = {}
      const namesById: Record<number, string> = {}
      for(const a of (areaObjs||[])){ idsByName[a.name] = a.id; namesById[a.id] = a.name }
      setAreaIdByName(idsByName); setAreaNameById(namesById)

      // 1) Matriz base (qty actuales)
      const { data, error } = await supabase.rpc('inventory_matrix', { p_department_id: effectiveDept })
      if(error){ alert(error.message); return }

      // 2) Item numbers (no tocamos tu RPC)
      const { data: itemsFlags, error: e2 } = await supabase
        .from('items_with_flags')
        .select('id,name,vendor,article_number,category_id')
      if(e2){ alert(e2.message); return }

      type nil = string | null | undefined
      const norm = (s:string|nil)=> (s??'').toString().trim().toLowerCase()

      const map = new Map<string,string>()
      const infoById: Record<number, {name:string, vendor:string|null, article_number:string|null, category_id:number}> = {}
      for(const it of (itemsFlags||[])){
        const key = `${norm(it.name)}||${norm(it.vendor)}`
        if(it.article_number) map.set(key, String(it.article_number))
        infoById[it.id] = {
          name: it.name,
          vendor: it.vendor ?? null,
          article_number: it.article_number ?? null,
          category_id: it.category_id as unknown as number
        }
      }
      setItemNumMap(map)
      setItemInfoById(infoById)

      // 3) Enriquecer filas con article_number
      const enriched: Row[] = (data||[]).map((r: any)=> {
        const key = `${norm(r.item)}||${norm(r.vendor)}`
        const art = map.get(key) || null
        return { ...r, article_number: art }
      })
      setRows(enriched)

      // 4) Catálogo de categorías
      const { data: catsTable } = await supabase.from('categories').select('id,name')
      const cMap: Record<number,string> = {}
      for(const c of (catsTable||[])) cMap[c.id] = c.name
      setCatNameById(cMap)

      // 5) Thresholds de las áreas del depto
      const areaIds = (areaObjs||[]).map(a=>a.id)
      if(areaIds.length){
        const { data: th, error: eTh } = await supabase
          .from('thresholds')
          .select('area_id,item_id,expected_qty')
          .in('area_id', areaIds)
        if(eTh){ alert(eTh.message); return }
        setThRaw(th||[])
      }else{
        setThRaw([])
      }

      // 6) opciones de áreas & selección por defecto
      const areasSet = Array.from(new Set((enriched || []).map((r) => String(r.area)))).sort((a,b)=>a.localeCompare(b))
      const catsSet  = Array.from(new Set((enriched || []).map((r) => String(r.category)))).sort((a,b)=>a.localeCompare(b))
      setAreas(areasSet); setCats(catsSet)
      // si no hay ninguna selección previa, selecciona todas
      setCompareAreas(prev => prev.size ? prev : new Set(areasSet))
    })()
  },[deptId, user.department_id, user.role])

  // --- Pivot/agrupación de la tabla principal ---
  type PivotRow = {
    category: string
    vendor: string
    item: string
    article_number: string | null
    areas: Record<string, number> // sumas por área
    total: number                 // suma de todas las áreas (global)
  }

  const { displayedAreas, groupedByCategory, colCount } = useMemo(()=>{
    // 1) Filtrar por categoría
    let base = rows
    if(catFilter !== 'all') base = base.filter(r => r.category === catFilter)

    // 2) Áreas a mostrar según filtro
    const allAreas = Array.from(new Set(base.map(r => r.area))).sort((a,b)=>a.localeCompare(b))
    let showAreas: string[] = []
    if (areaFilter === 'all') showAreas = allAreas
    else if (areaFilter === 'no-areas') showAreas = []
    else showAreas = allAreas.filter(a => a === areaFilter)

    // 3) Construir pivote
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
      const n = Number(r.qty) || 0
      acc.areas[r.area] = (acc.areas[r.area] || 0) + n
      acc.total += n
    }

    // 4) Orden
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
    const cols = 3 + showAreas.length + 1

    return { displayedAreas: showAreas, groupedByCategory: grouped, colCount: cols }
  }, [rows, catFilter, areaFilter])

  // helper: suma de las áreas que se muestran en una fila
  const sumDisplayedAreas = (pr: PivotRow) => {
    if (displayedAreas.length === 0) return pr.total // No Areas => total global
    return displayedAreas.reduce((s, a)=> s + (pr.areas[a] || 0), 0)
  }

  // ========================== TABLA COMPARATIVA ==========================
  const compareData = useMemo(()=>{
    const qtyByKeyArea = new Map<string, Record<string, number>>()
    const keyInfo = new Map<string, {category:string,vendor:string,item:string,article_number:string|null}>()

    let base = rows
    if(catFilter !== 'all') base = base.filter(r => r.category === catFilter)

    const keyOf = (r:Row) => `${r.category}||${r.vendor||''}||${r.item}||${r.article_number||''}`

    for(const r of base){
      const k = keyOf(r)
      if(!qtyByKeyArea.has(k)) qtyByKeyArea.set(k, {})
      qtyByKeyArea.get(k)![r.area] = (qtyByKeyArea.get(k)![r.area] || 0) + (Number(r.qty)||0)
      if(!keyInfo.has(k)) keyInfo.set(k, {category:r.category, vendor:r.vendor||'', item:r.item, article_number:r.article_number||null})
    }

    const thByKeyArea = new Map<string, Record<string, number>>()
    for(const th of thRaw){
      const areaName = areaNameById[th.area_id]
      const item = itemInfoById[th.item_id]
      if(!areaName || !item) continue
      const categoryName = catNameById[item.category_id] || ''
      const k = `${categoryName}||${item.vendor||''}||${item.name}||${item.article_number||''}`

      if(!thByKeyArea.has(k)) thByKeyArea.set(k, {})
      thByKeyArea.get(k)![areaName] = th.expected_qty || 0
      if(!keyInfo.has(k)) keyInfo.set(k, {category:categoryName, vendor:item.vendor||'', item:item.name, article_number:item.article_number||null})
    }

    const allKeys = Array.from(new Set([...Array.from(qtyByKeyArea.keys()), ...Array.from(thByKeyArea.keys())]))

    type CompRow = {
      category: string
      vendor: string
      item: string
      article_number: string|null
      byArea: Record<string, { qty:number, th:number }>
    }
    const compRows: CompRow[] = []

    for(const k of allKeys){
      const info = keyInfo.get(k)!
      const row: CompRow = { category: info.category, vendor: info.vendor, item: info.item, article_number: info.article_number, byArea: {} }
      const qtyMap = qtyByKeyArea.get(k) || {}
      const thMap  = thByKeyArea.get(k)  || {}
      for(const a of Array.from(compareAreas)){
        row.byArea[a] = {
          qty: qtyMap[a] || 0,
          th : thMap[a]  || 0
        }
      }
      compRows.push(row)
    }

    compRows.sort((a,b)=>{
      const c = a.category.localeCompare(b.category); if(c!==0) return c
      const i = a.item.localeCompare(b.item); if(i!==0) return i
      const v = a.vendor.localeCompare(b.vendor); if(v!==0) return v
      return (a.article_number||'').localeCompare(b.article_number||'')
    })

    const grouped = new Map<string, CompRow[]>()
    for(const r of compRows){
      if(!grouped.has(r.category)) grouped.set(r.category, [])
      grouped.get(r.category)!.push(r)
    }

    return { grouped }
  }, [rows, thRaw, areaNameById, itemInfoById, catNameById, catFilter, compareAreas])

  const qtyBg = (qty:number, th:number)=>{
    if(qty < th) return '#fde8e8'
    if(qty === th) return '#e6f4ea'
    return '#fff4e5'
  }

  useEffect(()=>{
    function onDocClick(e:MouseEvent){
      if(!areasDropdownOpen) return
      if(dropdownRef.current && !dropdownRef.current.contains(e.target as Node)){
        setAreasDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', onDocClick)
    return ()=> document.removeEventListener('mousedown', onDocClick)
  },[areasDropdownOpen])

  /* ========= Exportar a Excel (tabla principal tal cual se ve) ========= */
  function exportMainTable(){
    // helper para escapar HTML
    const esc = (s:any) =>
      String(s ?? '')
        .replace(/&/g,'&amp;')
        .replace(/</g,'&lt;')
        .replace(/>/g,'&gt;')
        .replace(/"/g,'&quot;')

    let html = ''
    html += `<table border="1" style="border-collapse:collapse;font-family:Arial,Helvetica,sans-serif;font-size:12px;">`
    // header
    html += '<thead><tr>'
    html += '<th>Vendor</th><th>Item</th><th>Item number</th>'
    for(const a of displayedAreas){ html += `<th>${esc(a)}</th>` }
    html += '<th>Total</th></tr></thead>'

    // body (mismo orden que en la UI)
    html += '<tbody>'
    const catsInOrder = Array.from(groupedByCategory.keys())
    if(catsInOrder.length===0){
      html += `<tr><td colspan="${colCount}">No data</td></tr>`
    }else{
      for(const cat of catsInOrder){
        html += `<tr><td colspan="${colCount}" style="background:#e9f0fb;font-weight:bold">${esc(cat)}</td></tr>`
        const itemsInCat = groupedByCategory.get(cat) || []
        itemsInCat.forEach(pr=>{
          html += '<tr>'
          html += `<td>${esc(pr.vendor)}</td>`
          html += `<td>${esc(pr.item)}</td>`
          html += `<td>${esc(pr.article_number || '')}</td>`
          for(const a of displayedAreas){
            html += `<td>${esc(pr.areas[a] || 0)}</td>`
          }
          html += `<td>${esc(sumDisplayedAreas(pr))}</td>`
          html += '</tr>'
        })
      }
    }
    html += '</tbody></table>'

    const doc = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body>${html}</body></html>`
    const blob = new Blob([doc], { type: 'application/vnd.ms-excel;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `Inventory_${new Date().toISOString().slice(0,10)}.xls`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  return (
    <div>
      {/* ==================== TABLA INVENTORY PRINCIPAL ==================== */}
      <div className="card">
        <h3 style={{marginTop:0}}>Inventory</h3>
        <div style={{display:'flex', gap:12, flexWrap:'wrap', alignItems:'center'}}>
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
        {/* Botón a la derecha */}
          <div style={{marginLeft:'auto'}}>
            <button className="btn btn-secondary" onClick={exportMainTable}>Export to Excel</button>
          </div>
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

                  {/* Filas pivotadas */}
                  {itemsInCat.map((pr, idx)=>(
                    <tr key={`${cat}-${idx}`}>
                      <td>{pr.vendor}</td>
                      <td>{pr.item}</td>
                      <td>{pr.article_number || ''}</td>
                      {displayedAreas.map(a=>{
                        const q = pr.areas[a] || 0
                        return <td key={`${cat}-${idx}-${a}`}>{q}</td>
                      })}
                      <td>{sumDisplayedAreas(pr)}</td>
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

      {/* ==================== TABLA COMPARATIVA (Qty | Threshold) ==================== */}
      <div className="card" style={{marginTop:16}}>
        <div style={{display:'flex', alignItems:'center', gap:12, marginBottom:8}}>
          <h4 style={{margin:'0'}}>Qty vs Threshold</h4>

          <div ref={dropdownRef} style={{position:'relative'}}>
            <button className="btn" onClick={()=> setAreasDropdownOpen(v=>!v)}>
              Areas: {compareAreas.size ? `${compareAreas.size} selected` : 'none'}
            </button>
            {areasDropdownOpen && (
              <div className="card" style={{position:'absolute', zIndex:5, top:'110%', left:0, padding:8, minWidth:220}}>
                <div style={{display:'flex', gap:8, marginBottom:8}}>
                  <button className="btn btn-secondary" onClick={()=> setCompareAreas(new Set(areas))}>All</button>
                  <button className="btn btn-secondary" onClick={()=> setCompareAreas(new Set())}>None</button>
                </div>
                <div style={{maxHeight:220, overflow:'auto', display:'grid', gap:4}}>
                  {areas.map(a=>{
                    const checked = compareAreas.has(a)
                    return (
                      <label key={a} style={{display:'flex', alignItems:'center', gap:8}}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e)=>{
                            setCompareAreas(prev=>{
                              const next = new Set(prev)
                              if(e.target.checked) next.add(a); else next.delete(a)
                              return next
                            })
                          }}
                        />
                        <span>{a}</span>
                      </label>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        </div>

        <div style={{overflowX:'auto'}}>
          <table style={{width:'100%', borderCollapse:'separate'}}>
            <thead>
              <tr>
                <th style={{position:'sticky', top:0, background:'white', zIndex:2}}>Vendor</th>
                <th style={{position:'sticky', top:0, background:'white', zIndex:2}}>Item</th>
                <th style={{position:'sticky', top:0, background:'white', zIndex:2}}>Item number</th>
                {Array.from(compareAreas).map(a=>(
                  <th key={`c1-${a}`} colSpan={2} style={{position:'sticky', top:0, background:'white', zIndex:2, textAlign:'center'}}>{a}</th>
                ))}
              </tr>
              <tr>
                <th style={{position:'sticky', top:28, background:'white', zIndex:2}}></th>
                <th style={{position:'sticky', top:28, background:'white', zIndex:2}}></th>
                <th style={{position:'sticky', top:28, background:'white', zIndex:2}}></th>
                {Array.from(compareAreas).map(a=>(
                  <React.Fragment key={`c2-${a}`}>
                    <th style={{position:'sticky', top:28, background:'white', zIndex:2}}>Qty</th>
                    <th style={{position:'sticky', top:28, background:'white', zIndex:2}}>Threshold</th>
                  </React.Fragment>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from(compareData.grouped.keys()).map(cat=>{
                const itemsInCat = compareData.grouped.get(cat) || []
                const spanCols = 3 + compareAreas.size*2
                return (
                  <React.Fragment key={`cmp-${cat}`}>
                    <tr>
                      <td colSpan={spanCols}
                          style={{
                            background:'#e9f0fb',
                            fontWeight:600,
                            borderTop:'1px solid #d1d9e6',
                            borderBottom:'1px solid #d1d9e6'
                          }}>
                        {cat}
                      </td>
                    </tr>
                    {itemsInCat.map((r, idx)=>(
                      <tr key={`r-${cat}-${idx}`}>
                        <td>{r.vendor}</td>
                        <td>{r.item}</td>
                        <td>{r.article_number || ''}</td>
                        {Array.from(compareAreas).map(a=>{
                          const pair = r.byArea[a] || {qty:0, th:0}
                          return (
                            <React.Fragment key={`pair-${a}`}>
                              <td style={{background: qtyBg(pair.qty, pair.th)}}>{pair.qty}</td>
                              <td>{pair.th}</td>
                            </React.Fragment>
                          )
                        })}
                      </tr>
                    ))}
                  </React.Fragment>
                )
              })}
              {compareData.grouped.size===0 && (
                <tr>
                  <td colSpan={3 + compareAreas.size*2} style={{opacity:.7, padding:'12px 4px'}}>No data</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
export default InventoryView
