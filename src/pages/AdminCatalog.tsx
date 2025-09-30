import React, { useEffect, useState } from 'react'
import { supabase } from '../utils/supabase'
import { Modal } from '../components/Modal'

type User = { id:string, username:string, role:'super_admin'|'admin'|'standard', department_id:number|null }

const AdminCatalog: React.FC<{user:User}> = ({user})=>{
  if(user.role!=='super_admin') return <div className="card"><strong>Access denied.</strong></div>

  const [users,setUsers]=useState<any[]>([])
  const [deps,setDeps]=useState<any[]>([])

  // ---- Modal USUARIOS (existente) ----
  const [open,setOpen]=useState(false)
  const [payload,setPayload]=useState<any>({})

  // ---- Modal DEPARTAMENTOS (nuevo) ----
  const [openDep,setOpenDep]=useState(false)
  const [depPayload,setDepPayload]=useState<any>({})  // { id?: number, name: string }

  useEffect(()=>{ refresh() },[])

  async function refresh(){
    const { data: u } = await supabase.from('users').select('id,username,role,department_id')
    setUsers(u||[])
    const { data: d } = await supabase.from('departments').select('*').order('id', { ascending:true })
    setDeps(d||[])
  }

  // ======== USUARIOS ========
  function openModal(initial:any={ id:null, username:'', password:'', role:'standard', department_id:null }){
    setPayload(initial); setOpen(true)
  }

  async function save(){
    if(!confirm('Are you sure?')) return
    const body = { ...payload, department_id: payload.role==='super_admin' ? null : payload.department_id }
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

  // ======== DEPARTAMENTOS ========
  function openDepModal(initial:any={ id:null, name:'' }){
    setDepPayload(initial); setOpenDep(true)
  }

  async function saveDepartment(){
    if(!depPayload?.name || !String(depPayload.name).trim()){
      alert('Department name is required'); return
    }
    if(!confirm('Save department?')) return
    const body = { name: String(depPayload.name).trim() }
    let error
    if (depPayload.id) {
      const res = await supabase.from('departments').update(body).eq('id', depPayload.id)
      error = res.error
    } else {
      const res = await supabase.from('departments').insert(body)
      error = res.error
    }
    if(error){ alert(error.message); return }
    setOpenDep(false)
    refresh()
  }

  async function removeDepartment(id:number){
    if(!confirm('Delete department? Users linked to this department may block deletion if constraints exist.')) return
    const { error } = await supabase.from('departments').delete().eq('id', id)
    if(error){ alert(error.message); return }
    refresh()
  }

  // Mapa id->nombre para mostrar en tabla de usuarios
  const depNameById: Record<number,string> = Object.fromEntries(deps.map((d:any)=>[d.id,d.name])) as any

  return (
    <div className="card">
      <h3 style={{marginTop:0}}>Admin-Catalog (Users & Departments)</h3>

      {/* ======= USERS ======= */}
      <section>
        <h4>Users</h4>
        <button className="btn btn-primary" onClick={()=>openModal()}>New user</button>
        <table>
          <thead>
            <tr><th>Username</th><th>Role</th><th>Department</th><th>Actions</th></tr>
          </thead>
          <tbody>
            {users.map(u=>(
              <tr key={u.id}>
                <td>{u.username}</td>
                <td>{u.role}</td>
                <td>{u.department_id ? (depNameById[u.department_id] ?? u.department_id) : '-'}</td>
                <td style={{display:'flex',gap:8}}>
                  <button className="btn btn-secondary" onClick={()=>openModal(u)}>Modify</button>
                  <button className="btn btn-danger" onClick={()=>removeUser(u.id)}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* ======= DEPARTMENTS ======= */}
      <section style={{marginTop:12}}>
        <h4>Departments</h4>
        <button className="btn btn-primary" onClick={()=>openDepModal()}>New department</button>
        <table>
          <thead>
            <tr><th>ID</th><th>Name</th><th>Actions</th></tr>
          </thead>
          <tbody>
            {deps.map(d=>(
              <tr key={d.id}>
                <td>{d.id}</td>
                <td>{d.name}</td>
                <td style={{display:'flex',gap:8}}>
                  <button className="btn btn-secondary" onClick={()=>openDepModal(d)}>Modify</button>
                  <button className="btn btn-danger" onClick={()=>removeDepartment(d.id)}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* MODAL USUARIO */}
      <Modal open={open} onClose={()=>setOpen(false)} title="User" footer={<>
        <button className="btn btn-secondary" onClick={()=>setOpen(false)}>Cancel</button>
        <button className="btn btn-primary" onClick={save}>Save</button>
      </>}>
        <div className="field">
          <label>Username</label>
          <input className="input" value={payload.username||''}
                 onChange={e=>setPayload({...payload, username:e.target.value})}/>
        </div>
        <div className="field">
          <label>Password</label>
          <input className="input" value={payload.password||''}
                 onChange={e=>setPayload({...payload, password:e.target.value})}/>
        </div>
        <div className="field">
          <label>Role</label>
          <select
            className="select"
            value={payload.role||'standard'}
            onChange={e=>{
              const role = e.target.value as any
              setPayload({
                ...payload,
                role,
                department_id: role==='super_admin' ? null : payload.department_id
              })
            }}
          >
            <option value="standard">standard</option>
            <option value="admin">admin</option>
            <option value="super_admin">super_admin</option>
          </select>
        </div>
        <div className="field">
          <label>Department</label>
          <select
            className="select"
            disabled={payload.role === 'super_admin'}
            value={payload.department_id ?? ''} // '' => null
            onChange={(e)=>{
              const v = e.target.value
              setPayload({
                ...payload,
                department_id: v === '' ? null : Number(v)
              })
            }}
          >
            <option value="">No department (super_admin)</option>
            {deps.map((d:any)=>(
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
        </div>
      </Modal>

      {/* MODAL DEPARTAMENTO */}
      <Modal open={openDep} onClose={()=>setOpenDep(false)} title="Department" footer={<>
        <button className="btn btn-secondary" onClick={()=>setOpenDep(false)}>Cancel</button>
        <button className="btn btn-primary" onClick={saveDepartment}>Save</button>
      </>}>
        <div className="field">
          <label>Name</label>
          <input
            className="input"
            value={depPayload.name || ''}
            onChange={e=>setDepPayload({...depPayload, name: e.target.value})}
            placeholder="e.g., Housekeeping"
          />
        </div>
      </Modal>
    </div>
  )
}
export default AdminCatalog
