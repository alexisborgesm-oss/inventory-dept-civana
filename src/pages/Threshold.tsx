import React, { useEffect, useMemo, useState } from 'react'
import { supabase } from '../utils/supabase'

type User = { id:string, username:string, role:'super_admin'|'admin'|'standard', department_id:number|null }

type Area = { id:number, name:string, department_id:number|null }
type Item = { id:number, name:string }
type ThresholdRec = { id:number, area_id:number, item_id:number, expected_qty:number }

const Threshold: React.FC<{user:User}> = ({user})=>{
  const canEdit = user.role==='admin' || user.role==='super_admin'

  const [areas, setAreas] = useState<Area[]>([])
  const [activeAreaId, setActiveAreaId] = useState<number| null>(null)

  const [items, setItems] = useState<Item[]>([])              // items asignados al área activa
  const [existing, setExisting] = useState<Record<number, ThresholdRec>>({}) // por item_id
  const [qtyByItem, setQtyByItem] = useState<Record<number, string>>({})     // inputs

  useEffect(()=>{ loadAreas() },[])

  async function loadAreas(){
    // super_admin: todas; admin/standard: solo su depto (si lo tiene)
    let q = supabase.from('areas').select('id,name,department_id').order('id')
    if(user.role!=='super_admin' && user.department_id){
      q = q.eq('department_id', user.department_id)
    }
    const { data: a, error } = await q
    if(error){ alert(error.message); return }
    setAreas(a||[])
    const first = (a && a.length) ? a[0].id : null
    setActiveAreaId(first)
    if(first) await loadAreaData(first)
  }

  async function loadAreaData(areaId:number){
    // 1) IDs de items asignados al área
    const { data: ai, error: eAI } = await supabase
      .from('area_items').select('item_id').eq('area_id', areaId)
    if(eAI){ alert(eAI.message); return }
    const ids = (ai||[]).map(r=>r.item_id)
    if(ids.length===0){
      setItems([]); setExisting({}); setQtyByItem({})
      return
    }

    // 2) Items
    const { data: its, error: eItems } = await supabase
  .from('items_with_flags')
  .select('id,name,is_valuable')
  .in('id', ids)
  .order('name', { ascending:true })
    if(eItems){ alert(eItems.message); return }
    setItems(its||[])

    // 3) Thresholds existentes del área
    const { data: ths, error: eTh } = await supabase
      .from('thresholds').select('id,area_id,item_id,expected_qty').eq('area_id', areaId)
    if(eTh){ alert(eTh.message); return }

    const mapExisting: Record<number, ThresholdRec> = {}
    const mapQty: Record<number, string> = {}
    for(const r of (ths||[])){
      mapExisting[r.item_id] = r as ThresholdRec
      mapQty[r.item_id] = String(r.expected_qty ?? '')
    }
    setExisting(mapExisting)
    setQtyByItem(mapQty)
  }

  const activeArea = useMemo(()=> areas.find(a=>a.id===activeAreaId) || null, [areas, activeAreaId])

  async function handleSave(){
    if(!activeAreaId) return
    if(!canEdit){ alert('No permission'); return }
    if(!confirm('Save thresholds for this area?')) return

    // Construir filas (sin "id") — ¡nunca envíes id en insert!
    const rows = items
      .map(it => {
        const v = qtyByItem[it.id]
        if(v===undefined || v===null || v==='') return null
        const n = Number(v)
        if(Number.isNaN(n) || n<0) return null;
        if (it.is_valuable && n > 1) {
  alert(`Item "${it.name}" is valioso; expected qty must be 0 or 1.`);
  throw new Error('valioso qty > 1');
}
        return { area_id: activeAreaId, item_id: it.id, expected_qty: n }
      })
      .filter(Boolean) as Array<{area_id:number,item_id:number,expected_qty:number}>

    try{
      // UPSERT con conflicto en (area_id,item_id)
      const { error: upErr } = await supabase
        .from('thresholds')
        .upsert(rows, { onConflict: 'area_id,item_id' })
      if(!upErr){
        await loadAreaData(activeAreaId)
        return
      }

      // Fallback: si tu tabla no tuviera el constraint único,
      // hacemos update/insert por fila (evita id:null)
      for(const r of rows){
        const existingRec = existing[r.item_id]
        if(existingRec){
          const { error } = await supabase.from('thresholds')
            .update({ expected_qty: r.expected_qty })
            .eq('id', existingRec.id)
          if(error) throw error
        }else{
          const { error } = await supabase.from('thresholds').insert(r) // sin id
          if(error) throw error
        }
      }
      await loadAreaData(activeAreaId)
    }catch(err:any){
      alert(err?.message || String(err))
    }
  }

  return (
    <div className="card">
      <h3 style={{marginTop:0}}>Threshold</h3>

      {/* Tabs de áreas */}
      <div style={{display:'flex', gap:8, flexWrap:'wrap', marginBottom:12}}>
        {areas.map(a=>(
          <button
            key={a.id}
            className="btn"
            style={{
              background: a.id===activeAreaId ? 'var(--btn-primary-bg,#e6f4ea)' : undefined
            }}
            onClick={async ()=>{
              setActiveAreaId(a.id)
              await loadAreaData(a.id)
            }}
          >
            {a.name}
          </button>
        ))}
      </div>

      {!activeArea && <div className="card">No areas available.</div>}

      {activeArea && (
        <>
          <table>
            <thead>
              <tr>
                <th style={{width:'60%'}}>Item</th>
                <th>Expected qty</th>
              </tr>
            </thead>
            <tbody>
              {items.length===0 && (
                <tr><td colSpan={2} style={{opacity:.7, padding:'12px 4px'}}>No items assigned to this area.</td></tr>
              )}
              {items.map(it=>(
                <tr key={it.id}>
                  <td>{it.name}</td>
                  <td>
                    <input
  className="input"
  style={{maxWidth:140}}
  type="number"
  min={0}
  max={it.is_valuable ? 1 : undefined}
  value={qtyByItem[it.id] ?? ''}
  onChange={e=>{
    const v = e.target.value;
    setQtyByItem(prev=>({...prev, [it.id]: v}));
  }}
/>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {canEdit && (
            <div style={{marginTop:12}}>
              <button className="btn btn-primary" onClick={handleSave}>Save</button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

export default Threshold
