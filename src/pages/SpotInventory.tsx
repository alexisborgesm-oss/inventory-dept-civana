import React, { useEffect, useMemo, useState } from 'react'
import { supabase } from '../utils/supabase'

type Role = 'super_admin' | 'admin' | 'standard'
type User = { id:string, username:string, role:Role, department_id:number|null }

type Dept = { id:number, name:string }
type Area = { id:number, name:string, department_id:number }
type Category = { id:number, name:string, department_id:number|null }

type ItemRow = {
  id:number
  name:string
  unit?:string|null
  vendor?:string|null
  category_id:number
  category_name:string
  current_qty:number
  is_valuable?:boolean|null
}

/* Helpers */
function todayDateOnly() {
  const d = new Date()
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

const SpotInventory: React.FC<{ user:User }> = ({ user }) => {
  const isSA   = user.role === 'super_admin'
  const isAdmin = user.role === 'admin'

  // Departamento efectivo
  const [deptId, setDeptId] = useState<number | null>(
    isSA ? null : (user.department_id ?? null)
  )
  const [departments, setDepartments] = useState<Dept[]>([])

  // Área / categorías / items
  const [areas, setAreas] = useState<Area[]>([])
  const [areaId, setAreaId] = useState<number | ''>('')

  const [categories, setCategories] = useState<Category[]>([])
  const [catFilter, setCatFilter]   = useState<number | 'all'>('all')

  const [items, setItems] = useState<ItemRow[]>([])
  const [newQtyByItem, setNewQtyByItem] = useState<Record<number,string>>({})

  // Otros campos
  const [inventoryDate, setInventoryDate] = useState<string>(todayDateOnly())
  const [note, setNote] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [refreshCounter, setRefreshCounter] = useState(0) // para recargar después de guardar

  /* ========== Cargar departamentos (solo super_admin) ========== */
  useEffect(() => {
    if (!isSA) return
    ;(async () => {
      const { data, error } = await supabase
        .from('departments')
        .select('id,name')
        .order('name')

      if (error) {
        alert(error.message)
        return
      }
      setDepartments(data || [])
    })()
  }, [isSA])

  /* ========== Cargar categorías del departamento ========== */
  useEffect(() => {
    if (!deptId) {
      setCategories([])
      return
    }
    ;(async () => {
      const { data, error } = await supabase
        .from('categories')
        .select('id,name,department_id')
        .eq('department_id', deptId)
        .order('name')

      if (error) {
        alert(error.message)
        return
      }
      setCategories(data || [])
    })()
  }, [deptId])

  /* ========== Cargar áreas del departamento ========== */
  useEffect(() => {
    if (!deptId) {
      setAreas([])
      setAreaId('')
      return
    }
    ;(async () => {
      const { data, error } = await supabase
        .from('areas')
        .select('id,name,department_id')
        .eq('department_id', deptId)
        .order('name')

      if (error) {
        alert(error.message)
        return
      }
      setAreas(data || [])
      if ((data || []).length && areaId === '') {
        setAreaId(data![0].id)
      }
    })()
  }, [deptId])

  /* ========== Cargar items + qty actual para el área seleccionada ========== */
  useEffect(() => {
    ;(async () => {
      if (!deptId || !areaId) {
        setItems([])
        setNewQtyByItem({})
        return
      }

      setLoading(true)
      try {
        // 1) items asignados al área
        const { data: ai, error: eAI } = await supabase
          .from('area_items')
          .select('item_id')
          .eq('area_id', Number(areaId))

        if (eAI) throw eAI
        const itemIds = (ai || []).map(r => r.item_id)
        if (!itemIds.length) {
          setItems([])
          setNewQtyByItem({})
          return
        }

        // 2) datos de items (desde vista items_with_flags)
        const { data: itemsData, error: eIt } = await supabase
          .from('items_with_flags')
          .select('id,name,unit,vendor,category_id,is_valuable')
          .in('id', itemIds)

        if (eIt) throw eIt

        // 3) qty actual corregida desde la vista v_current_item_qty_by_area
        const { data: current, error: eCur } = await supabase
          .from('v_current_item_qty_by_area')
          .select('item_id,current_qty')
          .eq('area_id', Number(areaId))
          .in('item_id', itemIds)

        if (eCur) throw eCur

        const currentMap = new Map<number, number>()
        ;(current || []).forEach((r: any) => {
          currentMap.set(r.item_id, Number(r.current_qty || 0))
        })

        const catNameById = new Map<number, string>()
        categories.forEach(c => catNameById.set(c.id, c.name))

        const rows: ItemRow[] = (itemsData || [])
          .map((it: any) => ({
            id: it.id,
            name: it.name,
            unit: it.unit ?? '',
            vendor: it.vendor ?? '',
            category_id: it.category_id,
            category_name: catNameById.get(it.category_id) || '',
            current_qty: currentMap.get(it.id) ?? 0,
            is_valuable: !!it.is_valuable,
          }))
          .sort((a, b) => {
            const c = a.category_name.localeCompare(b.category_name); if (c !== 0) return c
            const n = a.name.localeCompare(b.name); if (n !== 0) return n
            return (a.vendor || '').localeCompare(b.vendor || '')
          })

        setItems(rows)

        // mantener lo que el usuario haya escrito si recargas
        setNewQtyByItem(prev => {
          const next: Record<number, string> = {}
          for (const it of rows) {
            next[it.id] = prev[it.id] ?? ''
          }
          return next
        })
      } catch (err: any) {
        alert(err?.message || String(err))
      } finally {
        setLoading(false)
      }
    })()
  }, [deptId, areaId, categories, refreshCounter])

  /* ========== Filtro por categoría ========== */
  const visibleItems = useMemo(() => {
    if (catFilter === 'all') return items
    return items.filter(it => it.category_id === catFilter)
  }, [items, catFilter])

  /* ========== Guardar spot inventory ========== */
  async function saveSpotInventory() {
    if (isSA && !deptId) {
      alert('Please select a department')
      return
    }
    if (!deptId) {
      alert('No department associated to this user.')
      return
    }
    if (!areaId) {
      alert('Please select an area')
      return
    }
    if (!inventoryDate) {
      alert('Please set the inventory date')
      return
    }

    // Items a guardar (solo los que tengan algo escrito, incluyendo 0)
    const parsedRows = visibleItems
      .map(it => {
        const raw = newQtyByItem[it.id]
        if (raw === undefined || raw === '') return null
        const n = Number(raw)
        if (Number.isNaN(n) || n < 0) {
          throw new Error(`Invalid quantity for "${it.name}"`)
        }
        if (it.is_valuable && n > 1) {
          throw new Error(`"${it.name}" is valuable; quantity must be 0 or 1.`)
        }
        return { itemId: it.id, qty: n }
      })
      .filter(Boolean) as Array<{ itemId:number; qty:number }>

    if (!parsedRows.length) {
      alert('Please enter at least one quantity to save.')
      return
    }

    try {
      setLoading(true)

      // 1) Cabecera en spot_inventories
      const { data: header, error: eHdr } = await supabase
        .from('spot_inventories')
        .insert({
          department_id: deptId,
          area_id: Number(areaId),
          inventory_date: inventoryDate,
          user_id: user.id,
          note: note || ''
        })
        .select('id')
        .single()

      if (eHdr) throw eHdr
      const spotId = header!.id

      // 2) Detalle en spot_inventory_items
      const rows = parsedRows.map(r => ({
        spot_inventory_id: spotId,
        item_id: r.itemId,
        qty: r.qty
      }))

      const { error: eItems } = await supabase
        .from('spot_inventory_items')
        .insert(rows)

      if (eItems) throw eItems

      alert('Spot inventory saved successfully.')

      // Limpiar cantidades y refrescar para ver el current_qty actualizado
      setNewQtyByItem({})
      setRefreshCounter(x => x + 1)
    } catch (err: any) {
      alert(err?.message || String(err))
    } finally {
      setLoading(false)
    }
  }

  /* ========== Render ========== */
  return (
    <div>
      {/* Header / filtros */}
      <div className="card">
        <h3 style={{ marginTop: 0 }}>Spot Inventory (Focused)</h3>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))',
            gap: 12,
            alignItems: 'end'
          }}
        >
          {/* Department (solo super_admin) */}
          {isSA && (
            <div className="field">
              <label>Department</label>
              <select
                className="select"
                value={deptId ?? ''}
                onChange={e => {
                  const v = e.target.value ? Number(e.target.value) : null
                  setDeptId(v)
                  setAreaId('')
                }}
              >
                <option value="">Select department</option>
                {departments.map(d => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Area */}
          <div className="field">
            <label>Area</label>
            <select
              className="select"
              value={areaId}
              onChange={e => setAreaId(e.target.value ? Number(e.target.value) : '')}
              disabled={!deptId}
            >
              <option value="">
                {!deptId ? 'Select department first' : 'Select area'}
              </option>
              {areas.map(a => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </div>

          {/* Category filter */}
          <div className="field">
            <label>Category (optional)</label>
            <select
              className="select"
              value={catFilter}
              onChange={e => {
                const v = e.target.value
                setCatFilter(v === 'all' ? 'all' : Number(v))
              }}
            >
              <option value="all">All</option>
              {categories
                .slice()
                .sort((a, b) => a.name.localeCompare(b.name))
                .map(c => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </select>
          </div>

          {/* Fecha de inventario */}
          <div className="field">
            <label>Inventory date</label>
            <input
              type="date"
              className="input"
              value={inventoryDate}
              onChange={e => setInventoryDate(e.target.value)}
            />
          </div>

          {/* Nota opcional */}
          <div className="field">
            <label>Note (optional)</label>
            <input
              className="input"
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="Short description of this spot check"
            />
          </div>

          {/* Botón guardar */}
          <div className="field" style={{ textAlign: 'right' }}>
            <button
              className="btn btn-primary"
              onClick={saveSpotInventory}
              disabled={loading || !deptId || !areaId}
            >
              {loading ? 'Saving…' : 'Save spot inventory'}
            </button>
          </div>
        </div>
      </div>

      {/* Tabla de items */}
      <div className="card">
        <h4 style={{ marginTop: 0 }}>Items in selected area</h4>

        {!deptId ? (
          <div style={{ opacity: 0.8 }}>Select a department to see items.</div>
        ) : !areaId ? (
          <div style={{ opacity: 0.8 }}>Select an area to see items.</div>
        ) : loading && !items.length ? (
          <div style={{ opacity: 0.8 }}>Loading…</div>
        ) : visibleItems.length === 0 ? (
          <div style={{ opacity: 0.8 }}>No items for this selection.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>Category</th>
                  <th>Item</th>
                  <th>Unit</th>
                  <th>Vendor</th>
                  <th>Current Qty (corrected)</th>
                  <th>New Qty (this spot)</th>
                </tr>
              </thead>
              <tbody>
                {visibleItems.map(it => (
                  <tr key={it.id}>
                    <td>{it.category_name}</td>
                    <td>{it.name}</td>
                    <td>{it.unit || ''}</td>
                    <td>{it.vendor || ''}</td>
                    <td>{it.current_qty}</td>
                    <td>
                      <input
                        className="input"
                        style={{ maxWidth: 120 }}
                        type="number"
                        min={0}
                        max={it.is_valuable ? 1 : undefined}
                        value={newQtyByItem[it.id] ?? ''}
                        onChange={e => {
                          const v = e.target.value
                          setNewQtyByItem(prev => ({ ...prev, [it.id]: v }))
                        }}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

export default SpotInventory
