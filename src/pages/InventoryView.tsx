import React, { useEffect, useMemo, useState } from 'react'
import { supabase } from '../utils/supabase'

type User = { id:string, username:string, role:'super_admin'|'admin'|'standard', department_id:number|null }
type Dept = { id:number, name:string }
type Row = { area:string, category:string, item:string, unit?:string|null, vendor?:string|null, qty:number }

const InventoryView: React.FC<{user:User}> = ({user})=>{
  const [deptId, setDeptId] = useState<number | ''>(user.role==='super_admin' ? '' : (user.department_id || ''))
  const [departments, setDepartments] = useState<Dept[]>([])
  const [rows, setRows] = useState<Row[]>([])
  const [areas, setAreas] = useState<string[]>([])
  const [cats, setCats] = useState<string[]>([])
  const [areaFilter, setAreaFilter] = useState<string>('all')
  const [catFilter, setCatFilter] = useState<string>('all')
  const [sortKey, setSortKey] = useState<keyof Row>('item')
  const [asc, setAsc] = useState(true)

  useEffect(()=>{
    if(user.role==='super_admin'){
      supabase.from('departments').select('*').then(({data})=> setDepartments(data||[]))
    }
  },[user.role])

  useEffect(()=>{
    const effectiveDept = user.role==='super_admin' ? deptId : user.department_id
    if(!effectiveDept) return
    supabase.rpc('inventory_matrix', { p_department_id: effectiveDept })
    .then(({data, error})=>{
      if(error){ alert(error.message); return }
      setRows(data||[])
      const areas = Array.from(new Set((data||[]).map((r:any)=>r.area)))
      const cats = Array.from(new Set((data||[]).map((r:any)=>r.category)))
      setAreas(areas); setCats(cats)
    })
  },[deptId, user.department_id, user.role])

  const visible = useMemo(()=>{
    let r = rows
    if(areaFilter!=='all') r = r.filter(x=>x.area===areaFilter)
    if(catFilter!=='all') r = r.filter(x=>x.category===catFilter)
    r = [...r].sort((a,b)=>{
      const A = (a[sortKey]??'') as any, B = (b[sortKey]??'') as any
      if(A<B) return asc?-1:1
      if(A>B) return asc?1:-1
      return 0
    })
    return r
  },[rows, areaFilter, catFilter, sortKey, asc])

  const setSort = (k:keyof Row)=>{
    if(k===sortKey) setAsc(!asc); else { setSortKey(k); setAsc(true) }
  }

  return (
    <div>
      <div className="card">
        <h3 style={{marginTop:0}}>Inventory</h3>
        <div style={{display:'flex', gap:12, flexWrap:'wrap'}}>
          {user.role==='super_admin' && (
            <select className="select" value={deptId} onChange={e=> setDeptId(e.target.value?Number(e.target.value):'')}>
              <option value="">Select department</option>
              {departments.map(d=> <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          )}
          <select className="select" value={areaFilter} onChange={e=> setAreaFilter(e.target.value)}>
            <option value="all">All areas</option>
            {areas.map(a=> <option key={a} value={a}>{a}</option>)}
          </select>
          <select className="select" value={catFilter} onChange={e=> setCatFilter(e.target.value)}>
            <option value="all">All categories</option>
            {cats.map(c=> <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      </div>
      <div className="card">
        <table>
          <thead>
            <tr>
              <th onClick={()=>setSort('category')}>Category</th>
              <th onClick={()=>setSort('item')}>Item</th>
              <th onClick={()=>setSort('area')}>Area</th>
              <th onClick={()=>setSort('unit')}>Unit</th>
              <th onClick={()=>setSort('vendor')}>Vendor</th>
              <th onClick={()=>setSort('qty')}>Qty</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((r,i)=>(
              <tr key={i}>
                <td>{r.category}</td>
                <td>{r.item}</td>
                <td>{r.area}</td>
                <td>{r.unit||''}</td>
                <td>{r.vendor||''}</td>
                <td>{r.qty}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
export default InventoryView
