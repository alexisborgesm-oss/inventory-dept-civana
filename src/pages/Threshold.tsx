import React, { useEffect, useState } from 'react'
import { supabase } from '../utils/supabase'

type User = { id:string, username:string, role:'super_admin'|'admin'|'standard', department_id:number|null }
type Dept = { id:number, name:string }
type Area = { id:number, name:string, department_id:number }
type ThresholdRow = { id?:number, area_id:number, item_id:number, item:string, expected_qty:number }

const Threshold: React.FC<{user:User}> = ({user})=>{
  const [deptId, setDeptId] = useState<number | ''>(user.role==='super_admin' ? '' : (user.department_id || ''))
  const [deps,setDeps]=useState<Dept[]>([])
  const [areas,setAreas]=useState<Area[]>([])
  const [rows,setRows]=useState<ThresholdRow[]>([])

  useEffect(()=>{
    if(user.role==='super_admin'){
      supabase.from('departments').select('*').then(({data})=>setDeps(data||[]))
    }
  },[])

  useEffect(()=>{
    const dep = user.role==='super_admin' ? deptId : user.department_id
    if(!dep) return
    supabase.from('areas').select('*').eq('department_id', dep).then(({data})=> setAreas(data||[]))
  },[deptId])

  async function load(aid:number){
    const { data, error } = await supabase.rpc('threshold_for_area', { p_area_id: aid })
    if(error){ alert(error.message); return }
    setRows(data||[])
  }

  async function save(){
    if(!confirm('Are you sure to save thresholds?')) return
    const { error } = await supabase.from('thresholds').upsert(rows.map(r=>({ id:r.id, area_id:r.area_id, item_id:r.item_id, expected_qty:r.expected_qty })), { onConflict:'area_id,item_id' })
    if(error){ alert(error.message); return }
    alert('Saved.')
  }

  return (
    <div className="card">
      <h3 style={{marginTop:0}}>Threshold</h3>
      {user.role==='super_admin' && (
        <select className="select" value={deptId} onChange={e=> setDeptId(e.target.value?Number(e.target.value):'')}>
          <option value="">Select department</option>
          {deps.map(d=> <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
      )}
      <div style={{display:'flex', gap:8, flexWrap:'wrap', marginTop:8}}>
        {areas.map(a=> <button key={a.id} className="btn btn-secondary" onClick={()=>load(a.id)}>{a.name}</button>)}
      </div>
      <table style={{marginTop:12}}>
        <thead><tr><th>Item</th><th>Expected qty</th></tr></thead>
        <tbody>
          {rows.map((r,i)=>(<tr key={i}><td>{r.item}</td><td><input className="input" type="number" min="0" value={r.expected_qty} onChange={e=> setRows(prev=> prev.map((x,j)=> j===i?{...x, expected_qty:Number(e.target.value)}:x))}/></td></tr>))}
        </tbody>
      </table>
      {rows.length>0 && <button className="btn btn-primary" onClick={save} style={{marginTop:8}}>Save</button>}
    </div>
  )
}
export default Threshold
