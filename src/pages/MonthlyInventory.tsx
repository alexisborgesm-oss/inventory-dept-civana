import React, { useEffect, useMemo, useState } from 'react'
import { supabase } from '../utils/supabase'
import { exportToExcel } from '../utils/table'

type User = { id:string, username:string, role:'super_admin'|'admin'|'standard', department_id:number|null }
type Dept = { id:number, name:string }
type Row = { area:string, category:string, item:string, qty:number }

const MonthlyInventory: React.FC<{user:User}> = ({user})=>{
  const [deptId, setDeptId] = useState<number | ''>(user.role==='super_admin' ? '' : (user.department_id || ''))
  const [deps,setDeps]=useState<Dept[]>([])
  const [month,setMonth]=useState<number>(new Date().getMonth()+1)
  const [year,setYear]=useState<number>(new Date().getFullYear())
  const [rows,setRows]=useState<Row[]>([])
  const [pastOpen,setPastOpen]=useState(false)
  const [past,setPast]=useState<Row[]>([])

  useEffect(()=>{
    if(user.role==='super_admin'){
      supabase.from('departments').select('*').then(({data})=> setDeps(data||[]))
    }
  },[])

  useEffect(()=>{
    const dep = user.role==='super_admin' ? deptId : user.department_id
    if(!dep) return
    supabase.rpc('inventory_matrix', { p_department_id: dep }).then(({data})=> setRows(data||[]))
  },[deptId])

  async function saveMonthly(){
    const dep = user.role==='super_admin' ? deptId : user.department_id
    if(!dep){ alert('Select department'); return }
    if(!confirm('Save Monthly Inventory?')) return
    const { data: existing } = await supabase.from('monthly_inventories').select('id').eq('department_id', dep).eq('month', month).eq('year', year).maybeSingle()
    if(existing){
      if(!confirm('A monthly record exists for this month/year. Replace it?')) return
      await supabase.from('monthly_inventory_items').delete().eq('monthly_inventory_id', existing.id)
      await supabase.from('monthly_inventories').delete().eq('id', existing.id)
    }
    const { data: rec, error } = await supabase.from('monthly_inventories').insert({ department_id: dep, month, year, created_at: new Date().toISOString() }).select('*').single()
    if(error){ alert(error.message); return }
    const items = rows.map(r=>({ monthly_inventory_id: rec.id, area: r.area, category: r.category, item: r.item, qty: r.qty }))
    if(items.length){
      const { error: e2 } = await supabase.from('monthly_inventory_items').insert(items)
      if(e2){ alert(e2.message); return }
    }
    alert('Monthly inventory saved.')
  }

  async function loadPast(){
    const dep = user.role==='super_admin' ? deptId : user.department_id
    if(!dep){ alert('Select department'); return }
    const { data, error } = await supabase.rpc('monthly_inventory_get', { p_department_id: dep, p_month: month, p_year: year })
    if(error){ alert(error.message); return }
    setPast(data||[]); setPastOpen(true)
  }

  return (
    <div className="card">
      <h3 style={{marginTop:0}}>Monthly Inventory</h3>
      <div style={{display:'flex', gap:8, flexWrap:'wrap'}}>
        {user.role==='super_admin' && (
          <select className="select" value={deptId} onChange={e=> setDeptId(e.target.value?Number(e.target.value):'')}>
            <option value="">Select department</option>
            {deps.map(d=> <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        )}
        <select className="select" value={month} onChange={e=> setMonth(Number(e.target.value))}>{Array.from({length:12},(_,i)=>(<option value={i+1} key={i}>{i+1}</option>))}</select>
        <input className="input" type="number" value={year} onChange={e=> setYear(Number(e.target.value))}/>
        <button className="btn btn-primary" onClick={saveMonthly}>Save Monthly Inventory</button>
        <button className="btn btn-secondary" onClick={loadPast}>Past Inventories</button>
        {pastOpen && past.length>0 && <button className="btn btn-secondary" onClick={()=> exportToExcel(`monthly-${year}-${month}.xlsx`, past)}>Export</button>}
      </div>

      <div className="card" style={{marginTop:12}}>
        <h4 style={{marginTop:0}}>Current Snapshot</h4>
        <table>
          <thead><tr><th>Category</th><th>Item</th><th>Area</th><th>Qty</th></tr></thead>
          <tbody>{rows.map((r,i)=>(<tr key={i}><td>{r.category}</td><td>{r.item}</td><td>{r.area}</td><td>{r.qty}</td></tr>))}</tbody>
        </table>
      </div>

      {pastOpen && (
        <div className="card" style={{marginTop:12}}>
          <h4 style={{marginTop:0}}>Past Inventory – {month}/{year}</h4>
          <table>
            <thead><tr><th>Category</th><th>Item</th><th>Area</th><th>Qty</th></tr></thead>
            <tbody>{past.map((r,i)=>(<tr key={i}><td>{r.category}</td><td>{r.item}</td><td>{r.area}</td><td>{r.qty}</td></tr>))}</tbody>
          </table>
        </div>
      )}
    </div>
  )
}
export default MonthlyInventory
