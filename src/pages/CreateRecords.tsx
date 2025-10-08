import React, { useEffect, useMemo, useState } from 'react'
import { supabase } from '../utils/supabase'

type User = { id:string, username:string, role:'super_admin'|'admin'|'standard', department_id:number|null }
type Area = { id:number, name:string, department_id:number|null }
type Dept = { id:number, name:string }
type ItemRow = {
  id:number
  name:string
  unit?:string|null
  vendor?:string|null
  category_id:number
  category_name:string
  is_valuable?:boolean
}

/* ===== Helpers ===== */
function todayDateOnly() {
  const d = new Date()
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}
function fmtTimestampLocal(ts: string | Date) {
  const d = ts instanceof Date ? ts : new Date(ts)
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'short', timeStyle: 'medium' }).format(d)
}

const CreateRecords: React.FC<{ user:User }> = ({ user })=>{
  // Departamentos (solo super_admin)
  const [departments, setDepartments] = useState<Dept[]>([])
  const [selectedDeptId, setSelectedDeptId] = useState<number|''>(
    user.role==='super_admin' ? '' : (user.department_id ?? '')
  )

  // Selectores del header
  const [areas, setAreas] = useState<Area[]>([])
  const [areaId, setAreaId] = useState<number | ''>('')

  const [categories, setCategories] = useState<Record<number,string>>({})
  const [catFilter, setCatFilter] = useState<number | 'all'>('all')

  // Fechas
  const [inventoryDate, setInventoryDate] = useState<string>(todayDateOnly())
  const [savedAt] = useState<Date>(new Date())

  // Items + thresholds del área
  const [items, setItems] = useState<ItemRow[]>([])
  const [thresholdByItem, setThresholdByItem] = useState<Record<number, number>>({})
  const [qtyByItem, setQtyByItem] = useState<Record<number, string>>({})

  /* ===== Cargar departamentos (solo super_admin) ===== */
  useEffect(()=>{ (async ()=>{
    if (user.role !== 'super_admin') return
    const { data, error } = await supabase.from('departments').select('id,name').order('name')
    if (error){ alert(error.message); return }
    setDepartments(data||[])
  })() },[user.role])

  /* ===== Cargar áreas ===== */
  useEffect(()=>{ (async ()=>{
    let q = supabase.from('areas').select('id,name,department_id').order('name', { ascending: true })

    if (user.role === 'super_admin') {
      if (!selectedDeptId) { setAreas([]); setAreaId(''); return }
      q = q.eq('department_id', Number(selectedDeptId))
    } else {
      // admin y standard: su propio departamento
      if (user.department_id) q = q.eq('department_id', user.department_id)
    }

    const { data, error } = await q
    if(error){ alert(error.message); return }
    setAreas(data||[])
    if((data||[]).length && areaId==='') setAreaId(data![0].id)
  })() },[user.role, user.department_id, selectedDeptId])

  /* ===== Catálogo de categorías ===== */
  useEffect(()=>{ (async ()=>{
    const { data, error } = await supabase.from('categories').select('id,name').order('name')
    if(error){ alert(error.message); return }
    setCategories(Object.fromEntries((data||[]).map((c:any)=>[c.id, c.name])))
  })() },[])

  /* ===== Cargar items y thresholds ===== */
  useEffect(()=>{ (async ()=>{
    if(!areaId) { setItems([]); setThresholdByItem({}); setQtyByItem({}); return }

    const { data: ai, error: eAI } = await supabase
      .from('area_items')
      .select('item_id')
      .eq('area_id', Number(areaId))
    if(eAI){ alert(eAI.message); return }
    const itemIds = (ai||[]).map(r=>r.item_id)
    if(itemIds.length===0){
      setItems([]); setThresholdByItem({}); setQtyByItem({})
      return
    }

    const { data: itemsData, error: eItems } = await supabase
      .from('items_with_flags')
      .select('id,name,unit,vendor,category_id,is_valuable')
      .in('id', itemIds)
    if(eItems){ alert(eItems.message); return }

    const rows: ItemRow[] = (itemsData||[])
      .map((it:any)=>({
        id: it.id,
        name: it.name,
        unit: it.unit ?? '',
        vendor: it.vendor ?? '',
        category_id: it.category_id,
        category_name: categories[it.category_id] || '',
        is_valuable: !!it.is_valuable,
      }))
      .sort((a,b)=>{
        const c = a.category_name.localeCompare(b.category_name); if(c!==0) return c
        const n = a.name.localeCompare(b.name); if(n!==0) return n
        return (a.vendor||'').localeCompare(b.vendor||'')
      })

    setItems(rows)

    const { data: th, error: eTh } = await supabase
      .from('thresholds')
      .select('item_id,expected_qty')
      .eq('area_id', Number(areaId))
    if(eTh){ alert(eTh.message); return }
    const thMap: Record<number, number> = {}
    for(const t of (th||[])) thMap[t.item_id] = Number(t.expected_qty||0)
    setThresholdByItem(thMap)

    setQtyByItem(prev=>{
      const next: Record<number,string> = {}
      for(const it of rows){
        next[it.id] = prev[it.id] ?? ''
      }
      return next
    })
  })() },[areaId, categories])

  /* ===== Filtro por categoría opcional ===== */
  const visibleItems = useMemo(()=>{
    if(catFilter==='all') return items
    return items.filter(it=> it.category_id === catFilter)
  },[items, catFilter])

  /* ===== Guardar ===== */
  async function saveRecord(){
    if(user.role==='super_admin' && !selectedDeptId){
      alert('Please select a department')
      return
    }
    if(!areaId){ alert('Please select an area'); return }
    if(!inventoryDate){ alert('Please set the inventory date'); return }

    const toInsert = visibleItems.map(it=>{
      const v = qtyByItem[it.id]
      const n = v==='' || v===undefined || v===null ? 0 : Number(v)
      if(Number.isNaN(n) || n<0) return { item: it, qty: 0 }
      if(it.is_valuable && n>1){
        alert(`"${it.name}" is valuable; Current Qty must be 0 or 1.`)
        throw new Error('valioso>1')
      }
      return { item: it, qty: n }
    })

    try{
      const { data: rec, error: eRec } = await supabase
        .from('records')
        .insert({
          area_id: Number(areaId),
          inventory_date: inventoryDate,
          user_id: user.id,
        })
        .select('id')
        .single()
      if(eRec) throw eRec
      const record_id = rec!.id

      const rows = toInsert.map(r=> ({
        record_id,
        item_id: r.item.id,
        qty: r.qty
      }))
      if(rows.length){
        const { error: eItems } = await supabase.from('record_items').insert(rows)
        if(eItems) throw eItems
      }

      alert('Record saved successfully.')
      setQtyByItem({})
    }catch(err:any){
      if(String(err?.message||err).includes('valioso>1')) return
      alert(err?.message || String(err))
    }
  }

  return (
    <div>
      {/* ===== Header ===== */}
      <div className="card">
        <h3 style={{marginTop:0}}>Create Records</h3>

        <div style={{display:'grid', gridTemplateColumns:'1fr 1fr 1fr 1fr auto', gap:12, alignItems:'end'}}>

          {/* Department (solo super_admin) */}
          {user.role==='super_admin' && (
            <div className="field">
              <label>Department</label>
              <select
                className="select"
                value={selectedDeptId}
                onChange={e=>{
                  const v = e.target.value ? Number(e.target.value) : ''
                  setSelectedDeptId(v)
                  setAreaId('')
                }}
              >
                <option value="">Select department</option>
                {departments.map(d=> (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            </div>
          )}

          {/* Area */}
          <div className="field">
            <label>Area</label>
            <select className="select" value={areaId} onChange={e=> setAreaId(e.target.value?Number(e.target.value):'')} disabled={user.role==='super_admin' && !selectedDeptId}>
              <option value="">{user.role==='super_admin' && !selectedDeptId ? 'Select department first' : 'Select area'}</option>
              {areas.map(a=> <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>

          {/* Category (optional) */}
          <div className="field">
            <label>Category (optional)</label>
            <select
              className="select"
              value={catFilter}
              onChange={e=>{
                const v = e.target.value
                setCatFilter(v==='all' ? 'all' : Number(v))
              }}
            >
              <option value="all">All</option>
              {Object.entries(categories)
                .sort((a,b)=>a[1].localeCompare(b[1]))
                .map(([id,name])=> <option key={id} value={id}>{name}</option>)}
            </select>
          </div>

          {/* Inventory date */}
          <div className="field">
            <label>Inventory date</label>
            <input
              type="date"
              className="input"
              value={inventoryDate}
              onChange={e=> setInventoryDate(e.target.value)}
            />
          </div>

          {/* Saved at (auto) */}
          <div className="field">
            <label>Saved at (auto)</label>
            <input className="input" disabled value={fmtTimestampLocal(savedAt)} />
          </div>

          {/* Save */}
          <div className="field" style={{textAlign:'right'}}>
            <button className="btn btn-primary" onClick={saveRecord} disabled={!areaId || (user.role==='super_admin' && !selectedDeptId)}>Save record</button>
          </div>
        </div>
      </div>

      {/* ===== Items ===== */}
      <div className="card">
        <h4 style={{marginTop:0}}>Items</h4>
        <table>
          <thead>
            <tr>
              <th>Category</th>
              <th>Item</th>
              <th>Unit</th>
              <th>Vendor</th>
              <th>Expected (Threshold)</th>
              <th>Current Qty</th>
            </tr>
          </thead>
          <tbody>
            {visibleItems.length===0 && (
              <tr><td colSpan={6} style={{opacity:.7, padding:'12px 4px'}}>No items for this selection.</td></tr>
            )}
            {visibleItems.map(it=>{
              const th = thresholdByItem[it.id] ?? ''
              return (
                <tr key={it.id}>
                  <td>{it.category_name}</td>
                  <td>{it.name}</td>
                  <td>{it.unit || ''}</td>
                  <td>{it.vendor || ''}</td>
                  <td>{th}</td>
                  <td>
                    <input
                      className="input"
                      style={{maxWidth:120}}
                      type="number"
                      min={0}
                      max={it.is_valuable ? 1 : undefined}
                      value={qtyByItem[it.id] ?? ''}
                      onChange={e=>{
                        const v = e.target.value
                        setQtyByItem(prev=> ({ ...prev, [it.id]: v }))
                      }}
                    />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default CreateRecords
