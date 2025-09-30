import React, { useEffect, useMemo, useState } from 'react'
import { supabase } from '../utils/supabase'
import { Modal } from '../components/Modal'
import { exportToExcel } from '../utils/table'

type User = { id:string, username:string, role:'super_admin'|'admin'|'standard', department_id:number|null }
type Row = { id:number, area:string, inventory_date:string, created_at:string, user:string }

const Records: React.FC<{user:User}> = ({user}) => {
  const [rows, setRows] = useState<Row[]>([])
  const [open, setOpen] = useState(false)
  const [detail, setDetail] = useState<any[]>([])
  const [selected, setSelected] = useState<Row | null>(null)

  useEffect(()=>{
    supabase.rpc('records_list', { p_user_id: user.id, p_role: user.role, p_department_id: user.department_id })
    .then(({data,error})=>{
      if(error){ alert(error.message); return }
      setRows(data||[])
    })
  },[user.id, user.role, user.department_id])

  async function openDetails(r:Row){
    const { data, error } = await supabase.rpc('record_details', { p_record_id: r.id })
    if(error){ alert(error.message); return }
    setDetail(data||[]); setSelected(r); setOpen(true)
  }

  async function removeRecord(id:number){
    if(!(user.role==='admin' || user.role==='super_admin')) return
    if(!confirm('Are you sure to delete this record?')) return
    const { error } = await supabase.rpc('delete_record', { p_record_id: id })
    if(error){ alert(error.message); return }
    setRows(prev=> prev.filter(r=>r.id!==id))
  }

  return (
    <div className="card">
      <h3 style={{marginTop:0}}>Records</h3>
      <table>
        <thead>
          <tr><th>Area</th><th>Inventory date</th><th>Saved at</th><th>User</th><th>Actions</th></tr>
        </thead>
        <tbody>
          {rows.map(r=>(
            <tr key={r.id}>
              <td>{r.area}</td>
              <td>{new Date(r.inventory_date).toLocaleDateString()}</td>
              <td>{new Date(r.created_at).toLocaleString()}</td>
              <td>{r.user}</td>
              <td style={{display:'flex', gap:8}}>
                <button className="btn btn-secondary" onClick={()=>openDetails(r)}>Details</button>
                {(user.role==='admin'||user.role==='super_admin') && <button className="btn btn-danger" onClick={()=>removeRecord(r.id)}>Delete</button>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <Modal open={open} onClose={()=>setOpen(false)} title={selected ? `Record #${selected.id} – ${selected.area}` : 'Record'} footer={<>
        <button className="btn btn-secondary" onClick={()=>setOpen(false)}>Close</button>
        {detail.length>0 && <button className="btn btn-primary" onClick={()=> exportToExcel(`record-${selected?.id}.xlsx`, detail)}>Export to Excel</button>}
      </>}>
        <table>
          <thead><tr><th>Category</th><th>Item</th><th>Qty</th></tr></thead>
          <tbody>{detail.map((d,i)=>(<tr key={i}><td>{d.category}</td><td>{d.item}</td><td>{d.qty}</td></tr>))}</tbody>
        </table>
      </Modal>
    </div>
  )
}
export default Records
