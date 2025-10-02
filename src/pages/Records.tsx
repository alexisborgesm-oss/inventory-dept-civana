import React, { useEffect, useState } from 'react'
import { supabase } from '../utils/supabase'
import { fmtDateOnly, fmtTimestamp } from '../utils/dateOnly'

type User = { id:string, username:string, role:'super_admin'|'admin'|'standard', department_id:number|null }
type Rec = { id:number, area_id:number, user_id:string, inventory_date:string, created_at:string }

const Records: React.FC<{user:User}> = ({ user })=>{
  const [rows, setRows] = useState<Rec[]>([])
  const [areas, setAreas] = useState<Record<number,string>>({})
  const [users, setUsers] = useState<Record<string,string>>({})

  useEffect(()=>{ (async ()=>{
    const [{ data: r }, { data: a }, { data: u }] = await Promise.all([
      supabase.from('records').select('id,area_id,user_id,inventory_date,created_at').order('created_at', { ascending:false }),
      supabase.from('areas').select('id,name'),
      supabase.from('users').select('id,username')
    ])
    setRows(r || [])
    setAreas(Object.fromEntries((a||[]).map((x:any)=>[x.id, x.name])))
    setUsers(Object.fromEntries((u||[]).map((x:any)=>[x.id, x.username])))
  })() },[])

  async function remove(id:number){
    if(!confirm('Delete this record?')) return
    const { error } = await supabase.from('records').delete().eq('id', id)
    if(error){ alert(error.message); return }
    setRows(prev=> prev.filter(r=> r.id!==id))
  }

  function details(id:number){
    // Si ya tienes una vista/modal de detalles, llama a la tuya aquí:
    // navigate(`/records/${id}`) ó abre tu Modal existente.
    alert(`Open details for record #${id}`)
  }

  return (
    <div className="card">
      <h3 style={{marginTop:0}}>Records</h3>
      <table>
        <thead>
          <tr>
            <th>Area</th>
            <th>Inventory date</th>
            <th>Saved at</th>
            <th>User</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r=>(
            <tr key={r.id}>
              <td>{areas[r.area_id] || `#${r.area_id}`}</td>
              {/* 👇 PINTA EL DATE SIN DESFASE */}
              <td>{fmtDateOnly(r.inventory_date)}</td>
              {/* Puedes usar local o UTC (elige uno y deja fijo) */}
              <td>{fmtTimestamp(r.created_at /*, { utc: true }*/)}</td>
              <td>{users[r.user_id] || r.user_id}</td>
              <td style={{display:'flex', gap:8}}>
                <button className="btn btn-secondary" onClick={()=>details(r.id)}>Details</button>
                <button className="btn btn-danger" onClick={()=>remove(r.id)}>Delete</button>
              </td>
            </tr>
          ))}
          {rows.length===0 && (
            <tr><td colSpan={5} style={{opacity:.7, padding:'12px 4px'}}>No records</td></tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

export default Records
