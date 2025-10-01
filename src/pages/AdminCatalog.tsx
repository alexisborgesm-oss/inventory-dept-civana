import React, { useEffect, useState } from 'react'
import { supabase } from '../utils/supabase'
import { Modal } from '../components/Modal'

type Role = 'super_admin' | 'admin' | 'standard'
type User = { id:string, username:string, role:Role, department_id:number|null }

const AdminCatalog: React.FC<{user:User}> = ({user})=>{
  // Ahora admins también pueden entrar; los estándar no
  if(user.role!=='super_admin' && user.role!=='admin'){
    return <div className="card"><strong>Access denied.</strong></div>
  }

  const [users,setUsers]=useState<any[]>([])
  const [deps,setDeps]=useState<any[]>([])

  // ---- Modal USUARIOS ----
  const [open,setOpen]=useState(false)
  const [payload,setPayload]=useState<any>({}) // {id?, username, password?, role, department_id?}

  // ---- Modal DEPARTAMENTOS ---- (solo super_admin)
  const [openDep,setOpenDep]=useState(false)
  const [depPayload,setDepPayload]=useState<any>({})  // { id?: number, name: string }

  useEffect(()=>{ refresh() },[])

  async function refresh(){
    const { data: u } = await supabase.from('users').select('id,username,role,department_id')
    setUsers(u||[])
    const { data: d } = await supabase.from('departments').select('*').order('id', { ascending:true })
    setDeps(d||[])
  }

  // ========= Helpers =========
  const depNameById: Record<number,string> = Object.fromEntries(deps.map((d:any)=>[d.id,d.name])) as any

  const visibleUsers = user.role==='super_admin'
    ? users
    : users.filter(u => u.department_id === user.department_id) // admin ve solo su dpto

  const allowedRolesForEditor: Role[] = (user.role==='super_admin')
    ? ['standard','admin','super_admin']
    : ['standard','admin'] // admin no puede tocar super_admin

  // ========= USUARIOS =========
  function openModal(initial?:any){
    if(initial){
      // Editar existente
      setPayload({ ...initial, password:'' }) // password vacío => no se actualiza
      setOpen(true)
      return
    }
    // Nuevo
    if(user.role==='super_admin'){
      setPayload({ username:'', password:'', role:'standard', department_id:null })
    }else{
      // admin: forzamos su mismo department_id
      setPayload({ username:'', password:'', role:'standard', department_id:user.department_id })
    }
    setOpen(true)
  }

  async function save(){
    if(!confirm('Are you sure?')) return

    const isUpdate = !!payload.id

    // Reglas para admin
    let nextRole: Role = (payload.role || 'standard') as Role
    if(user.role==='admin'){
      // admin no puede crear super_admin
      if(nextRole === 'super_admin') nextRole = 'standard'
    }

    // Construir body
    const body: any = {
      username: String(payload.username || '').trim(),
      role: nextRole,
      department_id: (nextRole === 'super_admin')
        ? null
        : (user.role==='super_admin' ? (payload.department_id ?? null) : user.department_id) // admin: siempre su dpto
    }
    // password solo si viene no vacío
    if (payload.password && String(payload.password).trim() !== '') {
      body.password = String(payload.password)
    }

    // Validaciones de alcance para admin al editar
    if (isUpdate && user.role==='admin') {
      const original = users.find(u => u.id === payload.id)
      if (!original || original.department_id !== user.department_id) {
        alert('You can only modify users in your department.')
        return
      }
      if (original.role === 'super_admin') {
        alert('You cannot modify a super_admin.')
        return
      }
    }

    let error
    if (isUpdate) {
      const { error: e } = await supabase.from('users').update(body).eq('id', payload.id)
      error = e
    } else {
      // IMPORTANTE: no enviar id en insert
      const { error: e } = await supabase.from('users').insert(body)
      error = e
    }

    if(error){ alert(error.message); return }
    setOpen(false); refresh()
  }

  async function removeUser(targetId:string){
    const target = users.find(u=>u.id===targetId)
    if(!target){ alert('User not found'); return }

    // Reglas para admin
    if(user.role==='admin'){
      if(target.role==='super_admin'){
        alert('You cannot delete a super_admin.')
        return
      }
      if(target.department_id !== user.department_id){
        alert('You can only delete users in your department.')
        return
      }
    }
    if(!confirm(`Delete user "${target.username}"?`)) return

    const { error } = await supabase.from('users').delete().eq('id', targetId)
    if(error){ alert(error.message); return }
    refresh()
  }

  // ========= DEPARTAMENTOS (solo super_admin) =========
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

  // Borrado en cascada prudente (ya implementado antes) — solo super_admin
  async function removeDepartmentCascade(departmentId:number){
    const ok = confirm(
      '⚠️ Esto borrará PERMANENTEMENTE el departamento y TODOS sus datos asociados:\n' +
      '• Usuarios del departamento\n' +
      '• Áreas del departamento\n' +
      '• Thresholds de esas áreas\n' +
      '• Records y sus items de esas áreas\n' +
      '• Inventarios mensuales del departamento (y sus items)\n' +
      '• Enlaces Área–Item (area_items)\n' +
      '• Además, items y categorías se eliminarán SOLO si quedan huérfanos\n\n' +
      '¿Deseas continuar?'
    )
    if(!ok) return

    try{
      // 1) Áreas del departamento
      const { data: areaRows, error: eAreas } = await supabase.from('areas').select('id').eq('department_id', departmentId)
      if(eAreas) throw eAreas
      const areaIds = (areaRows||[]).map(r=>r.id)

      // 2) Inventarios mensuales (dept)
      const { data: mRows, error: eM } = await supabase.from('monthly_inventories').select('id').eq('department_id', departmentId)
      if(eM) throw eM
      const monthlyIds = (mRows||[]).map(r=>r.id)
      if(monthlyIds.length){
        const { error } = await supabase.from('monthly_inventory_items').delete().in('monthly_inventory_id', monthlyIds)
        if(error) throw error
        const { error: eDelM } = await supabase.from('monthly_inventories').delete().in('id', monthlyIds)
        if(eDelM) throw eDelM
      }

      // 3) Records de las áreas del departamento
      if(areaIds.length){
        const { data: rRows, error: eR } = await supabase.from('records').select('id').in('area_id', areaIds)
        if(eR) throw eR
        const recIds = (rRows||[]).map(r=>r.id)
        if(recIds.length){
          const { error } = await supabase.from('record_items').delete().in('record_id', recIds)
          if(error) throw error
          const { error: eDelRec } = await supabase.from('records').delete().in('id', recIds)
          if(eDelRec) throw eDelRec
        }

        // 4) Thresholds
        const { error: eT } = await supabase.from('thresholds').delete().in('area_id', areaIds)
        if(eT) throw eT

        // 5) Enlaces área–item
        const { data: areaItemLinks, error: eAILSel } = await supabase.from('area_items').select('item_id').in('area_id', areaIds)
        if(eAILSel) throw eAILSel
        const deptItemIds = Array.from(new Set((areaItemLinks||[]).map(r=>r.item_id)))

        const { error: eAIL } = await supabase.from('area_items').delete().in('area_id', areaIds)
        if(eAIL) throw eAIL

        // 6) Borrar ÁREAS
        const { error: eAreasDel } = await supabase.from('areas').delete().in('id', areaIds)
        if(eAreasDel) throw eAreasDel

        // 7) Intentar borrar ITEMS huérfanos
        if(deptItemIds.length){
          const { data: stillUsed, error: eStill } = await supabase
            .from('area_items')
            .select('item_id')
            .in('item_id', deptItemIds)
          if(eStill) throw eStill
          const usedSet = new Set((stillUsed||[]).map(r=>r.item_id))
          const itemsToDelete = deptItemIds.filter(id=> !usedSet.has(id))
          if(itemsToDelete.length){
            const { error: eDelItems } = await supabase.from('items').delete().in('id', itemsToDelete)
            if(eDelItems) throw eDelItems
          }

          // 8) Intentar borrar CATEGORÍAS huérfanas
          const { data: catsInUse, error: eCatsInUse } = await supabase.from('items').select('category_id')
          if(eCatsInUse) throw eCatsInUse
          const inUse = new Set((catsInUse||[]).map(r=>r.category_id).filter((x:any)=> x!=null))
          const { data: allCats, error: eAllCats } = await supabase.from('categories').select('id')
          if(eAllCats) throw eAllCats
          const catToDelete = (allCats||[]).map(r=>r.id).filter((id:any)=> !inUse.has(id))
          if(catToDelete.length){
            const { error: eDelCats } = await supabase.from('categories').delete().in('id', catToDelete)
            if(eDelCats) throw eDelCats
          }
        }
      }

      // 9) Usuarios del departamento
      const { error: eUsers } = await supabase.from('users').delete().eq('department_id', departmentId)
      if(eUsers) throw eUsers

      // 10) Finalmente, el DEPARTAMENTO
      const { error: eDept } = await supabase.from('departments').delete().eq('id', departmentId)
      if(eDept) throw eDept

      alert('Department and all associated data deleted.')
      refresh()
    }catch(err:any){
      alert('Error deleting department: ' + (err?.message || String(err)))
    }
  }

  return (
    <div className="card">
      <h3 style={{marginTop:0}}>
        {user.role==='super_admin'
          ? 'Admin-Catalog (Users & Departments)'
          : 'User Management (Your Department)'
        }
      </h3>

      {/* ======= USERS ======= */}
      <section>
        <h4>Users</h4>
        <button className="btn btn-primary" onClick={()=>openModal()}>New user</button>
        <table>
          <thead>
            <tr><th>Username</th><th>Role</th><th>Department</th><th>Actions</th></tr>
          </thead>
          <tbody>
            {visibleUsers.map(u=>(
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

      {/* ======= DEPARTMENTS (solo super_admin) ======= */}
      {user.role==='super_admin' && (
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
                    <button className="btn btn-danger" onClick={()=>removeDepartmentCascade(d.id)}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

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
              const role = (e.target.value as Role)
              // admin nunca puede seleccionar super_admin
              const safeRole: Role = (user.role==='admin' && role==='super_admin') ? 'standard' : role
              setPayload({
                ...payload,
                role: safeRole,
                department_id: safeRole==='super_admin'
                  ? null
                  : (user.role==='super_admin' ? payload.department_id : user.department_id)
              })
            }}
          >
            {allowedRolesForEditor.map(r=>(
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        </div>

        {/* Department selector:
            - super_admin: select editable con todos los departamentos
            - admin: bloqueado y forzado a su propio departamento */}
        <div className="field">
          <label>Department</label>
          {user.role==='super_admin' ? (
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
          ) : (
            <input
              className="input"
              value={depNameById[user.department_id as number] || ''}
              disabled
              readOnly
            />
          )}
        </div>
      </Modal>

      {/* MODAL DEPARTAMENTO (solo super_admin) */}
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
