import React, { useEffect, useState } from 'react'
import { supabase } from '../utils/supabase'
import { Modal } from '../components/Modal'

type User = { id:string, username:string, role:'super_admin'|'admin'|'standard', department_id:number|null }

const AdminCatalog: React.FC<{user:User}> = ({user})=>{
  if(user.role!=='super_admin') return <div className="card"><strong>Access denied.</strong></div>

  const [users,setUsers]=useState<any[]>([])
  const [deps,setDeps]=useState<any[]>([])
  const [open,setOpen]=useState(false)
  const [payload,setPayload]=useState<any>({})

  useEffect(()=>{ refresh() },[])

  async function refresh(){
    const { data: u } = await supabase.from('users').select('id,username,role,department_id')
    setUsers(u||[])
    const { data: d } = await supabase.from('departments').select('*')
    setDeps(d||[])
  }

  function openModal(initial:any={ id:null, username:'', password:'', role:'standard', department_id:null }){
    setPayload(initial); setOpen(true)
  }

  async function save(){
    if(!confirm('Are you sure?')) return
    const body = { ...payload }
    const { error } = payload.id
      ? await supabase.from('users').update(body).eq('id', payload.id)
      : await supabase.from('users').insert(body)
    if(error){ alert(error.message); return }
    setOpen(false); refresh()
  }

  async function removeUser(id:string){
    if(!confirm('Delete user?')) return
    const { error } = await supabase.from('users').delete().eq('id', id)
    if(error){ alert(error.message); return }
    refresh()
  }

  return (
    <div className="card">
      <h3 style={{marginTop:0}}>Admin-Catalog (Users & Departments)</h3>
      <section>
        <h4>Users</h4>
        <button className="btn btn-primary" onClick={()=>openModal()}>New user</button>
        <table><thead><tr><th>Username</th><th>Role</th><th>Department</th><th>Actions</th></tr></thead><tbody>
          {users.map(u=>(<tr key={u.id}><td>{u.username}</td><td>{u.role}</td><td>{u.department_id??'-'}</td><td style={{display:'flex',gap:8}}>
            <button className="btn btn-secondary" onClick={()=>openModal(u)}>Modify</button>
            <button className="btn btn-danger" onClick={()=>removeUser(u.id)}>Delete</button>
          </td></tr>))}
        </tbody></table>
      </section>
      <section style={{marginTop:12}}>
        <h4>Departments</h4>
        <table><thead><tr><th>ID</th><th>Name</th></tr></thead><tbody>
          {deps.map(d=>(<tr key={d.id}><td>{d.id}</td><td>{d.name}</td></tr>))}
        </tbody></table>
      </section>

      <Modal open={open} onClose={()=>setOpen(false)} title="User" footer={<>
        <button className="btn btn-secondary" onClick={()=>setOpen(false)}>Cancel</button>
        <button className="btn btn-primary" onClick={save}>Save</button>
      </>}>
        <div className="field"><label>Username</label><input className="input" value={payload.username||''} onChange={e=>setPayload({...payload, username:e.target.value})}/></div>
        <div className="field"><label>Password</label><input className="input" value={payload.password||''} onChange={e=>setPayload({...payload, password:e.target.value})}/></div>
        <div className="field"><label>Role</label>
          <select className="select" value={payload.role||'standard'} onChange={e=>setPayload({...payload, role:e.target.value})}>
            <option value="standard">standard</option>
            <option value="admin">admin</option>
            <option value="super_admin">super_admin</option>
          </select>
        </div>
        <div className="field"><label>Department (null for super_admin)</label><input className="input" type="number" value={payload.department_id??''} onChange={e=>setPayload({...payload, department_id:e.target.value?Number(e.target.value):null})}/></div>
      </Modal>
    </div>
  )
}
export default AdminCatalog
