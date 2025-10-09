import React, { useEffect, useMemo, useState } from 'react'
import { supabase } from '../utils/supabase'
import { Modal } from '../components/Modal'

type User = { id:string, username:string, role:'super_admin'|'admin'|'standard', department_id:number|null }

const Catalog: React.FC<{user:User}> = ({user})=>{
  const canAdmin = user.role==='admin' || user.role==='super_admin'
  const [deps, setDeps] = useState<any[]>([])
  const [areas, setAreas] = useState<any[]>([])
  const [cats, setCats] = useState<any[]>([])
  const [items, setItems] = useState<any[]>([])

  // Selección de departamento (solo super_admin)
  const [selectedDeptId, setSelectedDeptId] = useState<number | null>(null)

  // generic edit modal
  const [open, setOpen] = useState(false)
  const [entity, setEntity] = useState<'area'|'category'|'item'|'department'|null>(null)
  const [payload, setPayload] = useState<any>({})

  // link (items <-> areas) modal
  const [linkOpen, setLinkOpen] = useState(false)
  const [linkItem, setLinkItem] = useState<any | null>(null)
  const [linkDeptId, setLinkDeptId] = useState<number | ''>(user.role==='super_admin' ? '' : (user.department_id || ''))
  const [linkAreas, setLinkAreas] = useState<any[]>([])
  const [checkedAreas, setCheckedAreas] = useState<Set<number>>(new Set())

  useEffect(()=>{ refresh() },[selectedDeptId])

  async function refresh(){
    if(user.role==='super_admin'){
      const { data: d } = await supabase.from('departments').select('*').order('id')
      setDeps(d||[])
    }

    if(user.role==='super_admin'){
      if(!selectedDeptId){
        setAreas([]); setCats([]); setItems([])
        return
      }

      const { data: a } = await supabase
        .from('areas')
        .select('*')
        .eq('department_id', selectedDeptId)
        .order('id')
      setAreas(a||[])

      const { data: c } = await supabase
        .from('categories')
        .select('*')
        .eq('department_id', selectedDeptId)
        .order('id')
      setCats(c||[])

      const catIds = (c || []).map((x:any)=> x.id)
      if (catIds.length){
        const { data: i } = await supabase
          .from('items_with_flags')
          .select('*')
          .in('category_id', catIds)
          .order('id')
        setItems(i || [])
      } else {
        setItems([])
      }

    } else {
      const deptId = user.department_id ?? null

      let qAreas = supabase.from('areas').select('*')
      if(deptId) qAreas = qAreas.eq('department_id', deptId)
      const { data: a } = await qAreas.order('id')
      setAreas(a||[])

      let qCats = supabase.from('categories').select('*')
      if(deptId) qCats = qCats.eq('department_id', deptId)
      const { data: c } = await qCats.order('id')
      setCats(c||[])

      const catIds = (c || []).map((x:any)=> x.id)
      if (catIds.length){
        const { data: i } = await supabase
          .from('items_with_flags')
          .select('*')
          .in('category_id', catIds)
          .order('id')
        setItems(i || [])
      } else {
        setItems([])
      }
    }
  }

  function openModal(ent:any, initial:any={}){
    setEntity(ent)
    setPayload(initial)
    setOpen(true)
  }

  async function save(){
    if(!entity) return
    if(!confirm('Are you sure?')) return

    const table = entity==='department'?'departments':entity==='area'?'areas':entity==='category'?'categories':'items'
    let data:any

    if(entity==='item'){
      // Enviar SOLO columnas reales de items
      const name = String(payload.name || '').trim()
      const category_id = (payload.category_id ?? null)
      const unit = String(payload.unit ?? '').trim() || null
      const vendor = String(payload.vendor ?? '').trim() || null
      const article_number = String(payload.article_number ?? '').trim() || null

      // Usar categories.tagged para saber si es "valuable"
      const cat = (cats||[]).find((c:any)=> c.id === category_id)
      const is_valuable = !!cat?.tagged
      if(is_valuable && !article_number){
        alert("Article number is required when category is tagged.")
        return
      }

      data = { name, category_id, unit, vendor, article_number, is_valuable }

    } else if (entity==='area'){
      data = { ...payload }
      if(user.role!=='super_admin'){
        data.department_id = user.department_id
      }
      if(user.role==='super_admin' && selectedDeptId){
        data.department_id = selectedDeptId
      }

    } else if (entity==='category'){
      // Incluir department_id y tagged
      data = { ...payload }
      if(user.role==='super_admin'){
        data.department_id = selectedDeptId ?? null
      } else {
        data.department_id = user.department_id
      }
      // tagged siempre booleano
      data.tagged = !!payload.tagged

    } else {
      data = { ...payload }
    }

    const { error } = payload.id
      ? await supabase.from(table).update(data).eq('id', payload.id)
      : await supabase.from(table).insert(data)

    if(error){ alert(error.message); return }
    setOpen(false); refresh()
  }

  // ===== Soft delete (solo items tagged) =====
  async function softDeleteItem(id:number){
    if(!confirm('Archiving this item means that you no longer have it or it is broken. Continue?')) return
    const { error } = await supabase
      .from('items')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id)
    if(error){ alert(error.message); return }
    refresh()
  }

  // ===== Linking UI =====
  async function openLinkModal(item:any){
    setLinkItem(item)

    let currentDept = user.department_id
    if(user.role==='super_admin'){
      if(selectedDeptId){
        currentDept = selectedDeptId
        setLinkDeptId(selectedDeptId)
      }else{
        const { data: d } = await supabase.from('departments').select('id').order('id').limit(1)
        currentDept = d && d.length ? d[0].id : null
        setLinkDeptId(currentDept || '')
      }
    }

    let q = supabase.from('areas').select('id,name,department_id').order('id')
    if(user.role!=='super_admin' && user.department_id) q = q.eq('department_id', user.department_id)
    if(user.role==='super_admin' && currentDept) q = q.eq('department_id', currentDept as number)
    const { data: a, error: ea } = await q
    if(ea){ alert(ea.message); return }
    setLinkAreas(a||[])

    const { data: links, error: el } = await supabase.from('area_items').select('area_id').eq('item_id', item.id)
    if(el){ alert(el.message); return }
    const set = new Set<number>((links||[]).map(r=>r.area_id))
    if (item?.is_valuable && set.size > 1) {
      const first = Array.from(set)[0]
      set.clear()
      if (first !== undefined) set.add(first)
    }
    setCheckedAreas(set)
    setLinkOpen(true)
  }

  async function saveLinks(){
    if(!linkItem) return
    if(!confirm('Save area assignments for this item?')) return

    if (linkItem?.is_valuable && checkedAreas.size > 1) {
      alert('A tagged item can be assigned to only one area.')
      return
    }

    const { data: current } = await supabase.from('area_items').select('area_id').eq('item_id', linkItem.id)
    const currentSet = new Set<number>((current||[]).map(r=>r.area_id))

    const toAdd = Array.from(checkedAreas).filter(id=> !currentSet.has(id)).map(area_id=> ({ area_id, item_id: linkItem.id }))
    const toRemove = Array.from(currentSet).filter(id=> !checkedAreas.has(id))

    if(toAdd.length){
      const { error: e1 } = await supabase.from('area_items').upsert(toAdd, { onConflict: 'area_id,item_id' })
      if(e1){ alert(e1.message); return }
    }
    if(toRemove.length){
      for(const area_id of toRemove){
        const { error: e2 } = await supabase.from('area_items').delete().eq('area_id', area_id).eq('item_id', linkItem.id)
        if(e2){ alert(e2.message); return }
      }
    }
    setLinkOpen(false)
  }

  const filteredAreasForTable = useMemo(()=>areas,[areas])

  const catNameById = useMemo<Record<number, string>>(
    () => Object.fromEntries((cats||[]).map((c:any)=>[c.id, c.name])) as Record<number,string>,
    [cats]
  )

  // (Opcional defensivo): si el view items_with_flags trae deleted_at, evita mostrarlos
  const visibleItems = useMemo(()=>{
    return (items||[]).filter((it:any)=> !it.deleted_at)
  },[items])

  return (
    <div className="card">
      <h3 style={{marginTop:0}}>Catalog</h3>

      {/* Radios de departamentos (solo super_admin) */}
      {user.role==='super_admin' && (
        <section style={{marginBottom:16}}>
          <h4>Departments</h4>
          <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(240px,1fr))', gap:8, margin:'8px 0'}}>
            {deps.map(d=>(
              <label key={d.id} className="card" style={{display:'flex', alignItems:'center', gap:8, padding:8}}>
                <input
                  type="radio"
                  name="dept-choice"
                  checked={selectedDeptId === d.id}
                  onChange={()=> setSelectedDeptId(d.id)}
                />
                <span>{d.name} <small style={{opacity:.65}}>#{d.id}</small></span>
              </label>
            ))}
          </div>
          <button className="btn btn-primary" onClick={()=>openModal('department', { name:'' })}>New department</button>
          <table style={{marginTop:8}}>
            <thead><tr><th>Name</th><th>Actions</th></tr></thead>
            <tbody>
              {deps.map(d=>(
                <tr key={d.id}>
                  <td>{d.name}</td>
                  <td style={{display:'flex',gap:8}}>
                    <button className="btn btn-secondary" onClick={()=>openModal('department', d)}>Modify</button>
                    {/* Delete removido intencionalmente */}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {/* Áreas */}
      {(user.role!=='super_admin' || selectedDeptId) && (
        <section>
          <h4>Areas</h4>
          <button
            className="btn btn-primary"
            onClick={()=>openModal('area', {
              name:'',
              department_id: user.role==='super_admin'
                ? (selectedDeptId ?? null)
                : user.department_id
            })}
          >
            New area
          </button>
          <table><thead><tr><th>Name</th><th>Department</th><th>Actions</th></tr></thead><tbody>
            {filteredAreasForTable.map(a=>(
              <tr key={a.id}>
                <td>{a.name}</td>
                <td>{a.department_id}</td>
                <td style={{display:'flex',gap:8}}>
                  <button className="btn btn-secondary" onClick={()=>openModal('area', a)}>Modify</button>
                  {/* Delete removido intencionalmente */}
                </td>
              </tr>
            ))}
          </tbody></table>
        </section>
      )}

      {/* Categorías */}
      {(user.role!=='super_admin' || selectedDeptId) && (
        <section>
          <h4>Categories</h4>
          <button
            className="btn btn-primary"
            onClick={()=>openModal('category', {
              name:'',
              department_id: user.role==='super_admin'
                ? (selectedDeptId ?? null)
                : user.department_id,
              tagged: false
            })}
          >
            New category
          </button>
          <table><thead><tr><th>Name</th><th>Department</th><th>Actions</th></tr></thead><tbody>
            {cats.map(c=>(
              <tr key={c.id}>
                <td>{c.name}</td>
                <td>{c.department_id ?? ''}</td>
                <td style={{display:'flex',gap:8}}>
                  <button className="btn btn-secondary" onClick={()=>openModal('category', c)}>Modify</button>
                  {/* Delete removido intencionalmente */}
                </td>
              </tr>
            ))}
          </tbody></table>
        </section>
      )}

      {/* Ítems */}
      {(user.role!=='super_admin' || selectedDeptId) && (
        <section>
          <h4>Items</h4>
          <button className="btn btn-primary" onClick={()=>openModal('item', { name:'', category_id:null, unit:'', vendor:'', is_valuable:false, article_number:null })}>New item</button>
          <table><thead><tr><th>Name</th><th>Category</th><th>Unit</th><th>Vendor</th><th>Article #</th><th>Actions</th></tr></thead><tbody>
            {visibleItems.map(i=>(
              <tr key={i.id}>
                <td>{i.name}</td>
                <td>{i.category_id ? (catNameById[i.category_id] ?? i.category_id) : ''}</td>
                <td>{i.unit||''}</td>
                <td>{i.vendor||''}</td>
                <td>{i.article_number||''}</td>
                <td style={{display:'flex',gap:8, flexWrap:'wrap'}}>
                  <button className="btn btn-secondary" onClick={()=>openModal('item', i)}>Modify</button>
                  <button className="btn btn-secondary" onClick={()=>openLinkModal(i)}>Assign to Areas</button>
                  {/* Soft delete SOLO si es tagged (is_valuable) */}
                  {!!i.is_valuable && (
                    <button className="btn btn-danger" onClick={()=>softDeleteItem(i.id)}>Archive</button>
                  )}
                  {/* Delete removido intencionalmente */}
                </td>
              </tr>
            ))}
          </tbody></table>
        </section>
      )}

      {/* Edit modal */}
      <Modal open={open} onClose={()=>setOpen(false)} title={`Edit ${entity}`} footer={<>
        <button className="btn btn-secondary" onClick={()=>setOpen(false)}>Cancel</button>
        <button className="btn btn-primary" onClick={save}>Save</button>
      </>}>
        {entity==='department' && (<>
          <div className="field"><label>Name</label><input className="input" value={payload.name||''} onChange={e=>setPayload({...payload, name:e.target.value})}/></div>
        </>)}
        {entity==='area' && (<>
          {user.role==='super_admin' && <div className="field"><label>Department</label><input className="input" type="number" value={payload.department_id||''} onChange={e=>setPayload({...payload, department_id:Number(e.target.value)})}/></div>}
          <div className="field"><label>Name</label><input className="input" value={payload.name||''} onChange={e=>setPayload({...payload, name:e.target.value})}/></div>
        </>)}
        {entity==='category' && (<>
          {user.role==='super_admin' && <div className="field"><label>Department</label><input className="input" type="number" value={payload.department_id ?? (selectedDeptId ?? '')} onChange={e=>setPayload({...payload, department_id: e.target.value===''? null : Number(e.target.value) })}/></div>}
          <div className="field"><label>Name</label><input className="input" value={payload.name||''} onChange={e=>setPayload({...payload, name:e.target.value})}/></div>
          {/* NUEVO: checkbox para marcar si la categoría es "tagged" */}
          <div className="field">
            <label><input
              type="checkbox"
              checked={!!payload.tagged}
              onChange={e=>setPayload({...payload, tagged: e.target.checked})}
            /> Tagged (items require Article # and can be assigned to a single area)</label>
          </div>
        </>)}
        {entity==='item' && (<>
          <div className="field"><label>Name</label><input className="input" value={payload.name||''} onChange={e=>setPayload({...payload, name:e.target.value})}/></div>

          <div className="field">
            <label>Category</label>
            <select
              className="select"
              value={payload.category_id ?? ''} // '' => null
              onChange={(e)=>{
                const v = e.target.value
                const cid = v === '' ? null : Number(v)
                const cat = (cats||[]).find((c:any)=>c.id===cid)
                setPayload({
                  ...payload,
                  category_id: cid,
                  // derive de categories.tagged (no por nombre)
                  is_valuable: !!cat?.tagged
                })
              }}
            >
              <option value="">Select a category</option>
              {cats.map((c:any)=>(
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>

          <div className="field"><label>Unit (optional)</label><input className="input" value={payload.unit||''} onChange={e=>setPayload({...payload, unit:e.target.value})}/></div>
          <div className="field"><label>Vendor (optional)</label><input className="input" value={payload.vendor||''} onChange={e=>setPayload({...payload, vendor:e.target.value})}/></div>
          <div className="field"><label>Valuable category (auto if category is tagged)</label><input className="input" value={payload.is_valuable?'Yes':'No'} disabled/></div>
          <div className="field"><label>Article number (required if Valuable)</label><input className="input" value={payload.article_number||''} onChange={e=>setPayload({...payload, article_number:e.target.value})}/></div>
        </>)}
      </Modal>

      {/* Link modal */}
      <Modal open={linkOpen} onClose={()=>setLinkOpen(false)} title={linkItem ? `Assign "${linkItem.name}" to Areas` : 'Assign to Areas'} footer={<>
        <button className="btn btn-secondary" onClick={()=>setLinkOpen(false)}>Cancel</button>
        <button className="btn btn-primary" onClick={saveLinks}>Save</button>
      </>}>
        {user.role==='super_admin' && (
          <div className="field">
            <label>Department</label>
            <select
              className="select"
              value={linkDeptId}
              onChange={async (e)=>{
                const val = e.target.value ? Number(e.target.value) : ''
                setLinkDeptId(val)
                let q = supabase.from('areas').select('id,name,department_id').order('id')
                if(val) q = q.eq('department_id', Number(val))
                const { data: a } = await q
                setLinkAreas(a||[])
                setCheckedAreas(prev=>{
                  const filtered = new Set(Array.from(prev).filter(id=> (a||[]).some((ar:any)=>ar.id===id)))
                  if (linkItem?.is_valuable && filtered.size > 1) {
                    const first = Array.from(filtered)[0]
                    return new Set(first !== undefined ? [first] : [])
                  }
                  return filtered
                })
              }}
            >
              <option value="">All</option>
              {deps.map(d=> <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
        )}

        <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(220px,1fr))', gap:8, marginTop:8}}>
          {linkAreas.map(a=>{
            const isTagged_Item = !!linkItem?.is_valuable
            const checked = checkedAreas.has(a.id)
            return (
              <label key={a.id} className="card" style={{display:'flex', alignItems:'center', gap:8}}>
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={isTagged_Item && !checked && checkedAreas.size >= 1}
                  onChange={(e)=>{
                    const nextChecked = e.target.checked
                    setCheckedAreas(prev=>{
                      if(isTagged_Item){
                        return nextChecked ? new Set([a.id]) : new Set()
                      }else{
                        const next = new Set(prev)
                        if(nextChecked) next.add(a.id); else next.delete(a.id)
                        return next
                      }
                    })
                  }}
                />
                <span>{a.name} <small style={{opacity:.65}}>#{a.id}</small></span>
              </label>
            )
          })}
        </div>
      </Modal>
    </div>
  )
}
export default Catalog
