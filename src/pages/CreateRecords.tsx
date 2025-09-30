import React, { useEffect, useMemo, useState } from 'react'
import { supabase } from '../utils/supabase'
import { exportToExcel } from '../utils/table'

type User = { id:string, username:string, role:'super_admin'|'admin'|'standard', department_id:number|null }
type Dept = { id:number, name:string }
type Area = { id:number, name:string, department_id:number }
type Category = { id:number, name:string }
type Item = { id:number, name:string, category_id:number, unit?:string|null, vendor?:string|null }
type Threshold = { id:number, area_id:number, item_id:number, expected_qty:number }
type ItemRow = Item & { expected_qty?:number, current_qty?:number }

const todayIso = () => new Date().toISOString()

const CreateRecords: React.FC<{user:User}> = ({user})=>{
  const [departments, setDepartments] = useState<Dept[]>([])
  const [areas, setAreas] = useState<Area[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [items, setItems] = useState<ItemRow[]>([])
  const [deptId, setDeptId] = useState<number | ''>(user.role==='super_admin' ? '' : (user.department_id || ''))
  const [areaId, setAreaId] = useState<number | ''>('')
  const [categoryId, setCategoryId] = useState<number | ''>('')
  const [inventoryDate, setInventoryDate] = useState<string>(new Date().toISOString().slice(0,10))
  const [saving, setSaving] = useState(false)

  useEffect(()=>{
    if(user.role==='super_admin'){
      supabase.from('departments').select('id,name').then(({data})=> setDepartments(data||[]))
    }
  },[user.role])

  useEffect(()=>{
    const effectiveDept = user.role==='super_admin' ? deptId : user.department_id
    if(!effectiveDept) return
    supabase.from('areas').select('id,name,department_id').eq('department_id', effectiveDept).then(({data})=> setAreas(data||[]))
    supabase.from('categories').select('*').then(({data})=> setCategories(data||[]))
  },[deptId, user.department_id, user.role])

  async function loadItems(aid:number, cid?:number){
    // items for area by category (optional) + expected thresholds
    const { data: areaItems } = await supabase
      .from('area_items_view') // helper view; fallback to items by area via join table
      .select('*')
      .eq('area_id', aid)
    let rows = (areaItems||[]) as any[]
    if(cid) rows = rows.filter(r=>r.category_id===cid)
    setItems(rows.map(r=>({ id:r.item_id, name:r.item_name, category_id:r.category_id, unit:r.unit, vendor:r.vendor, expected_qty:r.expected_qty, current_qty:r.latest_qty })) )
  }

  useEffect(()=>{
    if(areaId) loadItems(areaId as number, categoryId||undefined)
  },[areaId, categoryId])

  function setQty(id:number, val:number){
    setItems(prev=> prev.map(it=> it.id===id ? {...it, current_qty: val} : it))
  }

  async function saveRecord(){
    if(!areaId){ alert('Select an area'); return }
    if(!confirm('Are you sure you want to save this inventory record?')) return
    setSaving(true)
    try{
      // Save into records + record_items; update latest quantities for the area only if the new record date is >= the latest for each item.
      const now = todayIso()
      const { data: rec, error } = await supabase.from('records').insert({
        area_id: areaId, user_id: user.id, inventory_date: inventoryDate, created_at: now
      }).select('*').single()
      if(error) throw error

      const itemsPayload = items.map(it => ({ record_id: rec.id, item_id: it.id, qty: Number(it.current_qty || 0) }))
      if(itemsPayload.length){
        const { error: e2 } = await supabase.from('record_items').insert(itemsPayload)
        if(e2) throw e2
      }

      // Update latest quantities per "most recent inventory_date" rule.
      // We'll rely on a SQL view to compute latest per area/item, so nothing else to do here.
      alert('Record saved.')
    }catch(err:any){
      alert('Error saving: ' + err.message)
    }finally{ setSaving(false) }
  }

  const effectiveDept = user.role==='super_admin' ? deptId : user.department_id

  return (
    <div>
      <div className="card">
        <h3 style={{marginTop:0}}>Create Records</h3>
        <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(220px, 1fr))', gap:12}}>
          {user.role==='super_admin' && (
            <div className="field">
              <label>Department</label>
              <select className="select" value={deptId} onChange={e=>{ setDeptId(e.target.value ? Number(e.target.value) : ''); setAreaId('') }}>
                <option value="">Select department</option>
                {departments.map(d=> <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
          )}
          <div className="field">
            <label>Area</label>
            <select className="select" value={areaId} onChange={e=> setAreaId(Number(e.target.value))} disabled={!effectiveDept}>
              <option value="">Select area</option>
              {areas.map(a=> <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Category (optional)</label>
            <select className="select" value={categoryId} onChange={e=> setCategoryId(e.target.value ? Number(e.target.value) : '')}>
              <option value="">All</option>
              {categories.map(c=> <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Inventory date</label>
            <input className="input" type="date" value={inventoryDate} onChange={e=> setInventoryDate(e.target.value)} />
          </div>
          <div className="field">
            <label>Saved at (auto)</label>
            <input className="input" value={new Date().toLocaleString()} disabled />
          </div>
        </div>
      </div>

      <div className="card">
        <div style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
          <h4 style={{margin:0}}>Items</h4>
          <button className="btn btn-primary" onClick={saveRecord} disabled={saving || !areaId}>{saving ? 'Saving...' : 'Save record'}</button>
        </div>
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
            {items.map(it=>(
              <tr key={it.id}>
                <td>{it.category_id}</td>
                <td>{it.name}</td>
                <td>{it.unit||''}</td>
                <td>{it.vendor||''}</td>
                <td>{it.expected_qty ?? ''}</td>
                <td>
                  <input className="input" type="number" min="0" value={it.current_qty ?? 0} onChange={e=> setQty(it.id, Number(e.target.value))} style={{maxWidth:120}}/>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
export default CreateRecords
