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

  // NUEVO: selección de departamento (solo super_admin)
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
    // Cargar departamentos siempre para super_admin (para los radios)
    if(user.role==='super_admin'){
      const { data: d } = await supabase.from('departments').select('*').order('id')
      setDeps(d||[])
    }

    // Categorías (no dependen del depto)
    const { data: c } = await supabase.from('categories').select('*').order('id')
    setCats(c||[])

    // Áreas
    if(user.role==='super_admin'){
      // si NO hay departamento seleccionado, no mostramos áreas ni items
      if(!selectedDeptId){
        setAreas([])
        setItems([])
        return
      }
      const { data: a } = await supabase
        .from('areas')
        .select('*')
        .eq('department_id', selectedDeptId)
        .order('id')
      setAreas(a||[])

      // Items filtrados por depto: ítems asignados a alguna área de este departamento
      const areaIds = (a||[]).map((r:any)=>r.id)
      if(areaIds.length){
        const { data: ai } = await supabase
          .from('area_items')
          .select('item_id')
          .in('area_id', areaIds)
        const itemIds = Array.from(new Set((ai||[]).map((r:any)=>r.item_id)))
        if(itemIds.length){
          const { data: i } = await supabase
            .from('items_with_flags')
            .select('*')
            .in('id', itemIds)
            .order('id')
          setItems(i||[])
        }else{
          setItems([])
        }
      }else{
        setItems([])
      }
    }else{
      // admin / standard: comportamiento previo (no modifico nada más)
      const { data: a } = await supabase.from('areas').select('*').order('id')
      setAreas(a||[])
      const { data: i } = await supabase.from('items_with_flags').select('*').order('id')
      setItems(i||[])
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

      // Validación UX: si la categoría elegida es 'Tagged_Item', exigir article_number
      const cat = (cats||[]).find((c:any)=> c.id === category_id)
      const is_valuable = !!(cat && String(cat.name).toLowerCase() === 'tagged_item')
      if(is_valuable && !article_number){
        alert("Article number is required when category is 'Tagged_Item'.")
        return
      }

      data = { name, category_id, unit, vendor, article_number, is_valuable }
    } else {
      // Otras entidades conservan tu comportamiento original
      data = { ...payload }
      if(entity==='area' && user.role!=='super_admin'){
        data.department_id = user.department_id
      }
      // Si es super_admin y hay dept seleccionado, al crear un área la ligamos ahí por defecto
      if(entity==='area' && user.role==='super_admin' && selectedDeptId){
        data.department_id = selectedDeptId
      }
    }

    const { error } = payload.id
      ? await supabase.from(table).update(data).eq('id', payload.id)
      : await supabase.from(table).insert(data)

    if(error){ alert(error.message); return }
    setOpen(false); refresh()
  }

  async function remove(ent:'department'|'area'|'category'|'item', id:number){
    if(!confirm('Are you sure to delete?')) return
    const table = ent==='department'?'departments':ent==='area'?'areas':ent==='category'?'categories':'items'
    const { error } = await supabase.from(table).delete().eq('id', id)
    if(error){ alert(error.message); return }
    refresh()
  }

  // ===== Linking UI =====
  async function openLinkModal(item:any){
    setLinkItem(item)
    // departments selector (only for super_admin) controls what areas we display
    let currentDept = user.department_id
    if(user.role==='super_admin'){
      // Usar el depto seleccionado en radios si existe
      if(selectedDeptId){
        currentDept = selectedDeptId
        setLinkDeptId(selectedDeptId)
      }else{
        // fallback al primero si no hay seleccionado (no debería pasar porque no mostramos items hasta seleccionar)
        const { data: d } = await supabase.from('departments').select('id').order('id').limit(1)
        currentDept = d && d.length ? d[0].id : null
        setLinkDeptId(currentDept || '')
      }
    }
    // Load areas para el depto elegido (o todas si admin)
    let q = supabase.from('areas').select('id,name,department_id').order('id')
    if(user.role!=='super_admin' && user.department_id) q = q.eq('department_id', user.department_id)
    if(user.role==='super_admin' && currentDept) q = q.eq('department_id', currentDept as number)
    const { data: a, error: ea } = await q
    if(ea){ alert(ea.message); return }
    setLinkAreas(a||[])

    // Load existing links para este item
    const { data: links, error: el } = await supabase.from('area_items').select('area_id').eq('item_id', item.id)
    if(el){ alert(el.message); return }
    const set = new Set<number>((links||[]).map(r=>r.area_id))
    // Si es Tagged_Item, normaliza a 1 selección como máximo
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

    // UX: evitar mandar varias áreas si es Tagged_Item
    if (linkItem?.is_valuable && checkedAreas.size > 1) {
      alert('A Tagged_Item item can be assigned to only one area.')
      return
    }

    // current links in DB
    const { data: current } = await supabase.from('area_items').select('area_id').eq('item_id', linkItem.id)
    const currentSet = new Set<number>((current||[]).map(r=>r.area_id))

    // compute adds/removes
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

  const filteredAreasForTable = useMemo(()=>{
    return areas
  },[areas])

  // ======== Mapa id -> nombre de categoría para mostrar en tablas ========
  const catNameById = useMemo<Record<number, string>>(
    () => Object.fromEntries((cats||[]).map((c:any)=>[c.id, c.name])) as Record<number,string>,
    [cats]
  )

  return (
    <div className="card">
      <h3 style={{marginTop:0}}>Catalog</h3>

      {/* ===== Radios de departamentos (solo super_admin) ===== */}
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
          {/* Botones de gestión de departamentos (sin cambios) */}
          <button className="btn btn-primary" onClick={()=>openModal('department', { name:'' })}>New department</button>
          <table style={{marginTop:8}}>
            <thead><tr><th>Name</th><th>Actions</th></tr></thead>
            <tbody>
              {deps.map(d=>(
                <tr key={d.id}>
                  <td>{d.name}</td>
                  <td style={{display:'flex',gap:8}}>
                    <button className="btn btn-secondary" onClick={()=>openModal('department', d)}>Modify</button>
                    <button className="btn btn-danger" onClick={()=>remove('department', d.id)}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {/* ===== Áreas (solo mostrar si:
            - admin (como antes), o
            - super_admin Y hay un dept seleccionado) ===== */}
      { (user.role!=='super_admin' || selectedDeptId) && (
        <section>
          <h4>Areas</h4>
          <button
            className="btn btn-primary"
            onClick={()=>openModal('area', {
              name:'',
              // si es super_admin y hay dept seleccionado, lo usamos
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
                  <button className="btn btn-danger" onClick={()=>remove('area', a.id)}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody></table>
        </section>
      )}

      {/* ===== Categorías (siempre) ===== */}
      <section>
        <h4>Categories</h4>
        <button className="btn btn-primary" onClick={()=>openModal('category', { name:'' })}>New category</button>
        <table><thead><tr><th>Name</th><th>Actions</th></tr></thead><tbody>
          {cats.map(c=>(
            <tr key={c.id}>
              <td>{c.name}</td>
              <td style={{display:'flex',gap:8}}>
                <button className="btn btn-secondary" onClick={()=>openModal('category', c)}>Modify</button>
                <button className="btn btn-danger" onClick={()=>remove('category', c.id)}>Delete</button>
              </td>
            </tr>
          ))}
        </tbody></table>
      </section>

      {/* ===== Items (igual que antes, pero solo se muestran si:
            - admin (como antes), o
            - super_admin y hay dept seleccionado) ===== */}
      { (user.role!=='super_admin' || selectedDeptId) && (
        <section>
          <h4>Items</h4>
          <button className="btn btn-primary" onClick={()=>openModal('item', { name:'', category_id:null, unit:'', vendor:'', is_valuable:false, article_number:null })}>New item</button>
          <table><thead><tr><th>Name</th><th>Category</th><th>Unit</th><th>Vendor</th><th>Article #</th><th>Actions</th></tr></thead><tbody>
            {items.map(i=>(
              <tr key={i.id}>
                <td>{i.name}</td>
                {/* Mostrar NOMBRE de categoría */}
                <td>{i.category_id ? (catNameById[i.category_id] ?? i.category_id) : ''}</td>
                <td>{i.unit||''}</td>
                <td>{i.vendor||''}</td>
                <td>{i.article_number||''}</td>
                <td style={{display:'flex',gap:8, flexWrap:'wrap'}}>
                  <button className="btn btn-secondary" onClick={()=>openModal('item', i)}>Modify</button>
                  <button className="btn btn-secondary" onClick={()=>openLinkModal(i)}>Assign to Areas</button>
                  <button className="btn btn-danger" onClick={()=>remove('item', i.id)}>Delete</button>
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
          <div className="field"><label>Name</label><input className="input" value={payload.name||''} onChange={e=>setPayload({...payload, name:e.target.value})}/></div>
        </>)}
        {entity==='item' && (<>
          <div className="field"><label>Name</label><input className="input" value={payload.name||''} onChange={e=>setPayload({...payload, name:e.target.value})}/></div>

          {/* Selector por NOMBRE de categoría (guarda category_id) */}
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
                  // Solo para visualización: derive is_valuable si la categoría se llama 'Tagged_Item'
                  is_valuable: cat ? (String(cat.name).toLowerCase() === 'tagged_item') : false
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
          <div className="field"><label>Valuable category (auto if category name 'Tagged_Item')</label><input className="input" value={payload.is_valuable?'Yes':'No'} disabled/></div>
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
                // reload areas for selected department
                let q = supabase.from('areas').select('id,name,department_id').order('id')
                if(val) q = q.eq('department_id', Number(val))
                const { data: a } = await q
                setLinkAreas(a||[])
                // preserve checked where still visible
                setCheckedAreas(prev=>{
                  const filtered = new Set(Array.from(prev).filter(id=> (a||[]).some((ar:any)=>ar.id===id)))
                  // Si es Tagged_Item, normaliza a 1 selección como máximo
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
                        // Tagged_Item: solo una área a la vez
                        return nextChecked ? new Set([a.id]) : new Set()
                      }else{
                        // Normal: varias áreas
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
