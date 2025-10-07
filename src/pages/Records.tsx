import React, { useEffect, useState } from 'react' 
import { supabase } from '../utils/supabase'
import { fmtDateOnly, fmtTimestamp } from '../utils/dateOnly'
import { Modal } from '../components/Modal'

type User = { id:string, username:string, role:'super_admin'|'admin'|'standard', department_id:number|null }
type Rec = { id:number, area_id:number, user_id:string, inventory_date:string, created_at:string }

const Records: React.FC<{user:User}> = ({ user })=>{
  const [rows, setRows] = useState<Rec[]>([])
  const [areas, setAreas] = useState<Record<number,string>>({})
  const [users, setUsers] = useState<Record<string,string>>({})

  // --- departamentos (solo super_admin) ---
  const [deps, setDeps] = useState<Array<{id:number,name:string}>>([])
  const [selectedDeptId, setSelectedDeptId] = useState<number | null>(null)

  // ---- estado del modal de detalles ----
  const [detailOpen, setDetailOpen] = useState(false)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailHeader, setDetailHeader] = useState<{
    area: string, inventory_date: string, created_at: string, user: string
  } | null>(null)
  const [detailItems, setDetailItems] = useState<Array<{
    category: string, item: string, unit?: string|null, vendor?: string|null, qty: number
  }>>([])

  // ---- carga inicial de usuarios (tabla users) ----
  useEffect(()=>{ (async ()=>{
    const { data: u } = await supabase.from('users').select('id,username')
    setUsers(Object.fromEntries((u||[]).map((x:any)=>[x.id, x.username])))
  })() },[])

  // ---- cargar departamentos si es super_admin ----
  useEffect(()=>{ (async ()=>{
    if(user.role==='super_admin'){
      const { data: d } = await supabase.from('departments').select('id,name').order('id')
      setDeps(d||[])
    }
  })() },[user.role])

  // ---- cargar registros según rol / departamento seleccionado ----
  useEffect(()=>{ (async ()=>{
    try{
      // Determinar el depto de trabajo
      let workingDeptId: number | null = null
      if(user.role==='super_admin'){
        // si no hay dept seleccionado, no mostramos nada todavía
        if(selectedDeptId===null){
          setRows([]); setAreas({})
          return
        }
        workingDeptId = selectedDeptId
      }else{
        workingDeptId = user.department_id ?? null
      }

      // Cargar áreas del departamento (si no hay, la lista queda vacía)
      let qAreas = supabase.from('areas').select('id,name')
      if(workingDeptId) qAreas = qAreas.eq('department_id', workingDeptId)
      const { data: a } = await qAreas
      const areaMap = Object.fromEntries((a||[]).map((x:any)=>[x.id, x.name]))
      setAreas(areaMap)

      const areaIds = Object.keys(areaMap).map(id=> Number(id))
      if(areaIds.length===0){
        setRows([])
        return
      }

      // Cargar records SOLO de esas áreas
      const { data: r } = await supabase
        .from('records')
        .select('id,area_id,user_id,inventory_date,created_at')
        .in('area_id', areaIds)
        .order('created_at', { ascending:false })

      setRows(r || [])
    }catch(err:any){
      alert(err?.message || String(err))
    }
  })() },[user.role, user.department_id, selectedDeptId])

  async function remove(id:number){
    if(!confirm('Delete this record?')) return
    const { error } = await supabase.from('records').delete().eq('id', id)
    if(error){ alert(error.message); return }
    setRows(prev=> prev.filter(r=> r.id!==id))
  }

  async function details(id:number){
    // Header del modal con info que ya tenemos en memoria
    const rec = rows.find(r=> r.id===id)
    if(!rec){
      alert('Record not found')
      return
    }
    setDetailHeader({
      area: areas[rec.area_id] || `#${rec.area_id}`,
      inventory_date: fmtDateOnly(rec.inventory_date),
      created_at: fmtTimestamp(rec.created_at),
      user: users[rec.user_id] || rec.user_id
    })
    setDetailItems([])
    setDetailLoading(true)
    setDetailOpen(true)

    try{
      // 1) record_items del record
      const { data: ris, error: e1 } = await supabase
        .from('record_items')
        .select('item_id, qty')
        .eq('record_id', id)
      if(e1) throw e1

      const itemIds = (ris||[]).map(r=> r.item_id)
      if(itemIds.length===0){
        setDetailItems([])
        setDetailLoading(false)
        return
      }

      // 2) datos de items (desde la vista que ya usas)
      const { data: items, error: e2 } = await supabase
        .from('items_with_flags')
        .select('id,name,unit,vendor,category_id')
        .in('id', itemIds)
      if(e2) throw e2

      // 3) nombres de categorías sólo para las usadas
      const usedCatIds = Array.from(new Set((items||[]).map((it:any)=> it.category_id)))
      let catNameById: Record<number,string> = {}
      if(usedCatIds.length){
        const { data: cats } = await supabase
          .from('categories')
          .select('id,name')
          .in('id', usedCatIds)
        catNameById = Object.fromEntries((cats||[]).map((c:any)=> [c.id, c.name]))
      }

      // 4) armar filas detalle
      const qtyByItemId = new Map<number, number>()
      for(const r of (ris||[])) qtyByItemId.set(r.item_id, Number(r.qty)||0)

      const rowsDetail = (items||[])
        .map((it:any)=> ({
          category: catNameById[it.category_id] || '',
          item: it.name as string,
          unit: it.unit ?? '',
          vendor: it.vendor ?? '',
          qty: qtyByItemId.get(it.id) ?? 0
        }))
        .sort((a,b)=>{
          const c = a.category.localeCompare(b.category); if(c!==0) return c
          const i = a.item.localeCompare(b.item); if(i!==0) return i
          return (a.vendor||'').localeCompare(b.vendor||'')
        })

      setDetailItems(rowsDetail)
    }catch(err:any){
      alert(err?.message || String(err))
    }finally{
      setDetailLoading(false)
    }
  }

  return (
    <div className="card">
      <h3 style={{marginTop:0}}>Records</h3>

      {/* Selector de departamentos (solo super_admin) */}
      {user.role==='super_admin' && (
        <section style={{marginBottom:12}}>
          <h4 style={{margin:'8px 0'}}>Departments</h4>
          <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(220px,1fr))', gap:8}}>
            {deps.map(d=>(
              <label key={d.id} className="card" style={{display:'flex', alignItems:'center', gap:8, padding:8}}>
                <input
                  type="radio"
                  name="dept-filter"
                  checked={selectedDeptId === d.id}
                  onChange={()=> setSelectedDeptId(d.id)}
                />
                <span>{d.name} <small style={{opacity:.65}}>#{d.id}</small></span>
              </label>
            ))}
          </div>
          {!selectedDeptId && <div style={{opacity:.7, marginTop:6}}>Select a department to view its records.</div>}
        </section>
      )}

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
              <td>{fmtDateOnly(r.inventory_date)}</td>
              <td>{fmtTimestamp(r.created_at /*, { utc: true }*/)}</td>
              <td>{users[r.user_id] || r.user_id}</td>
              <td style={{display:'flex', gap:8}}>
                <button className="btn btn-secondary" onClick={()=>details(r.id)}>Details</button>
                {(user.role === 'super_admin' || user.role === 'admin') && (
    <button className="btn btn-danger" onClick={()=>remove(r.id)}>Delete</button>
  )}
              </td>
            </tr>
          ))}
          {rows.length===0 && (
            <tr><td colSpan={5} style={{opacity:.7, padding:'12px 4px'}}>No records</td></tr>
          )}
        </tbody>
      </table>

      {/* ---- Modal de detalles ---- */}
      <Modal
        open={detailOpen}
        onClose={()=>setDetailOpen(false)}
        title="Record details"
        footer={<button className="btn btn-primary" onClick={()=>setDetailOpen(false)}>Close</button>}
      >
        {!detailHeader ? (
          <div style={{opacity:.75}}>No record selected.</div>
        ) : (
          <>
            <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, marginBottom:12}}>
              <div><strong>Area:</strong> {detailHeader.area}</div>
              <div><strong>User:</strong> {detailHeader.user}</div>
              <div><strong>Inventory date:</strong> {detailHeader.inventory_date}</div>
              <div><strong>Saved at:</strong> {detailHeader.created_at}</div>
            </div>

            <div className="card" style={{boxShadow:'none', padding:0}}>
              <table>
                <thead>
                  <tr>
                    <th>Category</th>
                    <th>Item</th>
                    <th>Unit</th>
                    <th>Vendor</th>
                    <th>Qty</th>
                  </tr>
                </thead>
                <tbody>
                  {detailLoading && (
                    <tr><td colSpan={5} style={{opacity:.7, padding:'12px 4px'}}>Loading…</td></tr>
                  )}
                  {!detailLoading && detailItems.length===0 && (
                    <tr><td colSpan={5} style={{opacity:.7, padding:'12px 4px'}}>No items in this record.</td></tr>
                  )}
                  {!detailLoading && detailItems.map((it,idx)=>(
                    <tr key={idx}>
                      <td>{it.category}</td>
                      <td>{it.item}</td>
                      <td>{it.unit || ''}</td>
                      <td>{it.vendor || ''}</td>
                      <td>{it.qty}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Modal>
    </div>
  )
}

export default Records
