import React, { useEffect, useMemo, useState } from 'react'
import { Route, Routes, Link, useNavigate } from 'react-router-dom'
import { supabase } from './utils/supabase'
import { useIdleLogout } from './utils/useIdleLogout'
import CreateRecords from './pages/CreateRecords'
import InventoryView from './pages/InventoryView'
import Records from './pages/Records'
import Catalog from './pages/Catalog'
import Threshold from './pages/Threshold'
import Archived from './pages/Archived'
import MonthlyInventory from './pages/MonthlyInventory'
import AdminCatalog from './pages/AdminCatalog'
import ChangePassword from "./components/ChangePassword";
import { Modal } from './components/Modal'
import Dashboard from './pages/Dashboard'  // <-- NUEVO
import SpotInventory from './pages/SpotInventory'

type UserRow = { id:string, username:string, role:'super_admin'|'admin'|'standard', department_id: number | null }

export default function App(){
  const [user, setUser] = useState<UserRow | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)

  // --- estado modal cambio de contraseña ---
  const [pwdOpen, setPwdOpen] = useState(false)
  const [pwdCur, setPwdCur] = useState('')
  const [pwdNew, setPwdNew] = useState('')
  const [pwdNew2, setPwdNew2] = useState('')
  const [pwdLoading, setPwdLoading] = useState(false)

  const navigate = useNavigate()

  const idleMin = Number(import.meta.env.VITE_SESSION_IDLE_MINUTES || 15)
  useIdleLogout(()=>{
    if(!user) return
    alert('Session closed due to inactivity.')
    doLogout()
  }, idleMin)

  useEffect(()=>{
    const raw = localStorage.getItem('inv_user')
    if(raw){
      try{ setUser(JSON.parse(raw)) }catch{}
    }
  },[])

  function doLogout(){
    localStorage.removeItem('inv_user')
    setUser(null)
    setPwdOpen(false)
    setPwdCur(''); setPwdNew(''); setPwdNew2(''); setPwdLoading(false)
    navigate('/')
  }

  async function handleChangePassword(){
    if(!user) return
    if(!pwdCur || !pwdNew || !pwdNew2){
      alert('Please complete all fields.')
      return
    }
    if(pwdNew !== pwdNew2){
      alert('New password and confirmation do not match.')
      return
    }
    if(pwdNew.length < 6){
      alert('New password must be at least 6 characters.')
      return
    }
    setPwdLoading(true)
    try{
      // 1) Verificar contraseña actual
      const { data: found, error: e1 } = await supabase
        .from('users')
        .select('id')
        .eq('id', user.id)
        .eq('password', pwdCur)
        .maybeSingle()
      if(e1) throw e1
      if(!found){
        alert('Current password is incorrect.')
        return
      }
      // 2) Actualizar contraseña
      const { error: e2 } = await supabase
        .from('users')
        .update({ password: pwdNew })
        .eq('id', user.id)
      if(e2) throw e2

      alert('Password updated successfully.')
      setPwdOpen(false)
      setPwdCur(''); setPwdNew(''); setPwdNew2('')
    }catch(err:any){
      alert(err?.message || String(err))
    }finally{
      setPwdLoading(false)
    }
  }

  return (
    <div className="app">
      <Nav
        user={user}
        onLogout={doLogout}
        menuOpen={menuOpen}
        setMenuOpen={setMenuOpen}
        onOpenChangePassword={()=> setPwdOpen(true)}
      />
      <div className="container">
        {!user ? <Login onLogin={setUser}/> :
          <Routes>
            <Route path="/" element={<CreateRecords user={user}/>} />
            <Route path="/inventory" element={<InventoryView user={user}/>} />
            <Route path="/records" element={<Records user={user}/>} />
            <Route path="/catalog" element={<Catalog user={user}/>} />
            <Route path="/threshold" element={<Threshold user={user}/>} />
            <Route path="/monthly-inventory" element={<MonthlyInventory user={user}/>} />
            <Route path="/admin-catalog" element={<AdminCatalog user={user}/>} />
            <Route path="/dashboard" element={<Dashboard user={user}/>} /> {/* <-- NUEVO */}
            <Route path="/spot-inventory" element={<SpotInventory user={user} />} />
            <Route path="*" element={<CreateRecords user={user}/>} />
            <Route path="/archived" element={<Archived user={user}/>} />
          </Routes>
        }
      </div>

      {/* Modal Cambiar contraseña (responsive, usa tu Modal existente) */}
      <Modal
        open={pwdOpen}
        onClose={()=>{ if(!pwdLoading) setPwdOpen(false) }}
        title="Change password"
        footer={
          <>
            <button className="btn btn-secondary" onClick={()=> setPwdOpen(false)} disabled={pwdLoading}>Cancel</button>
            <button className="btn btn-primary" onClick={handleChangePassword} disabled={pwdLoading}>
              {pwdLoading ? 'Saving…' : 'Save'}
            </button>
          </>
        }
      >
        <div className="field">
          <label>Current password</label>
          <input className="input" type="password" value={pwdCur} onChange={e=>setPwdCur(e.target.value)} />
        </div>
        <div className="field">
          <label>New password</label>
          <input className="input" type="password" value={pwdNew} onChange={e=>setPwdNew(e.target.value)} />
        </div>
        <div className="field">
          <label>Confirm new password</label>
          <input className="input" type="password" value={pwdNew2} onChange={e=>setPwdNew2(e.target.value)} />
        </div>
      </Modal>
    </div>
  )
}

const Nav: React.FC<{
  user:UserRow|null,
  onLogout:()=>void,
  menuOpen:boolean,
  setMenuOpen:(b:boolean)=>void,
  onOpenChangePassword:()=>void
}> = ({user,onLogout,menuOpen,setMenuOpen,onOpenChangePassword}) => {
  return (
    <nav className="navbar">
      <div className="brand">Inventory</div>
      <div className="right">
        {user && <>
          <Link to="/">Create Records</Link>
          <Link to="/inventory">Inventory</Link>

          {/* Nombre clickeable para abrir modal de contraseña */}
          <button
            className="user"
            style={{ background:'transparent', border:'none', cursor:'pointer', padding:0 }}
            onClick={onOpenChangePassword}
            aria-label="Change password"
          >
            Signed in: {user.username}
          </button>

          <div className={menuOpen ? 'dropdown open' : 'dropdown'}>
            <button className="btn btn-secondary" onClick={()=>setMenuOpen(!menuOpen)}>More ▾</button>
            <div className="dropdown-menu" onClick={()=>setMenuOpen(false)}>
              <Link to="/records">Records</Link>
              <Link to="/spot-inventory">Spot Inventory</Link>
              {(user.role==='admin' || user.role==='super_admin') && <Link to="/catalog">Catalog</Link>}
              {(user.role==='admin' || user.role==='super_admin') && <Link to="/threshold">Threshold</Link>}
              {(user.role==='admin' || user.role==='super_admin') && <Link to="/monthly-inventory">Monthly Inventory</Link>}              
              {(user.role==='super_admin' || user.role==='admin') && <Link to="/admin-catalog">Admin-Catalog</Link>}
               {(user.role==='super_admin' || user.role==='admin') && <Link to="/archived">Archived</Link>}{/* <-- NUEVO */}
              {(user.role==='super_admin' || user.role==='admin') && <Link to="/dashboard">Dashboard</Link>}{/* <-- NUEVO */}
              <a onClick={onLogout}>Logout</a>
            </div>
          </div>
        </>}
      </div>
    </nav>
  )
}

const Login: React.FC<{onLogin:(u:UserRow)=>void}> = ({onLogin}) => {
  const [username, setUsername] = React.useState('')
  const [password, setPassword] = React.useState('')
  const [loading, setLoading] = React.useState(false)
  const navigate = useNavigate()

  async function handleLogin(e:React.FormEvent){
    e.preventDefault()
    setLoading(true)
    try{
      // Custom users table auth (username/password)
      const { data, error } = await supabase
        .from('users')
        .select('id, username, role, department_id')
        .eq('username', username)
        .eq('password', password)
        .limit(1)
        .maybeSingle()

      if(error) throw error
      if(!data){ alert('Invalid credentials'); return }
      onLogin(data as any)
      localStorage.setItem('inv_user', JSON.stringify(data))
      navigate('/')
    }catch(err:any){
      alert('Login error: ' + err.message)
    }finally{ setLoading(false) }
  }

  return (
    <div className="container">
      <div className="card" style={{maxWidth:480, margin:'2rem auto'}}>
        <h2 style={{marginTop:0, marginBottom:'1rem'}}>Sign in</h2>
        <form onSubmit={handleLogin}>
          <div className="field">
            <label>Username</label>
            <input className="input" value={username} onChange={e=>setUsername(e.target.value)} placeholder="Enter username" required />
          </div>
          <div className="field">
            <label>Password</label>
            <input className="input" type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="Enter password" required />
          </div>
          <button className="btn btn-primary" disabled={loading} type="submit">{loading ? 'Authenticating...' : 'Enter'}</button>
        </form>
      </div>
    </div>
  )
}
