import React, { useEffect, useState } from 'react'
import { supabase } from '../utils/supabase'
import { todayDateOnly, fromDateInput } from '../utils/dateOnly'

type User = { id:string, username:string, role:'super_admin'|'admin'|'standard', department_id:number|null }
type Area = { id:number, name:string, department_id:number|null }

const CreateRecord: React.FC<{user:User}> = ({ user })=>{
  const [areas, setAreas] = useState<Area[]>([])
  const [areaId, setAreaId] = useState<number | ''>('')
  const [inventoryDate, setInventoryDate] = useState<string>(todayDateOnly())

  useEffect(()=>{ (async ()=>{
    let q = supabase.from('areas').select('id,name,department_id').order('name')
    if(user.role!=='super_admin' && user.department_id){
      q = q.eq('department_id', user.department_id)
    }
    const { data } = await q
    setAreas(data||[])
    if((data||[]).length && areaId==='') setAreaId(data![0].id)
  })() },[user.role, user.department_id])

  async function save(){
    if(!areaId){ alert('Pick an area'); return }
    // ❗️ NO conviertas el date a ISO; envía el string tal cual
    const payload = {
      area_id: Number(areaId),
      inventory_date: fromDateInput(inventoryDate), // 'YYYY-MM-DD'
      user_id: user.id,
    }
    const { error } = await supabase.from('records').insert(payload)
    if(error){ alert(error.message); return }
    alert('Record saved')
  }

  return (
    <div className="card">
      <h3 style={{marginTop:0}}>Create Records</h3>
      <div className="field">
        <label>Area</label>
        <select className="select" value={areaId} onChange={e=> setAreaId(e.target.value?Number(e.target.value):'')}>
          <option value="">Select area</option>
          {areas.map(a=> <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </div>

      <div className="field">
        <label>Inventory date</label>
        <input
          type="date"
          className="input"
          value={inventoryDate}
          onChange={e => setInventoryDate(e.target.value)}
        />
      </div>

      <button className="btn btn-primary" onClick={save}>Save</button>
    </div>
  )
}

export default CreateRecord
