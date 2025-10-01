import React, { useEffect, useMemo, useState } from 'react'
import { Route, Routes, Link, useNavigate } from 'react-router-dom'
import { supabase } from './utils/supabase'
import { useIdleLogout } from './utils/useIdleLogout'
import CreateRecords from './pages/CreateRecords'
import InventoryView from './pages/InventoryView'
import Records from './pages/Records'
import Catalog from './pages/Catalog'
import Threshold from './pages/Threshold'
import MonthlyInventory from './pages/MonthlyInventory'
import AdminCatalog from './pages/AdminCatalog'

type UserRow = { id:string, username:string, role:'super_admin'|'admin'|'standard', department_id: number | null }

export default function App(){
  const [user, setUser] = useState<UserRow | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const navigate = useNavigate()

  const idleMin = Number(import.meta.env.VITE_SESSION_IDLE_MINUTES || 15)
  useIdleLogout(()=>{
    if(!user) return
    alert('Session closed due to inactivity.')
    doLogout()
  }, idleMin)

  useEffect(()=>{
    // restore from localStorage
    const raw = localStorage.getItem('inv_user')
    if(raw){
      try{ setUser(JSON.parse(raw)) }catch{}
    }
  },[])

  function doLogout(){
    localStorage.removeItem('inv_user')
    setUser(null)
    navigate('/')
  }

  return (
    <div className="app">
      <Nav user={user} onLogout={doLogout} menuOpen={menuOpen} setMenuOpen={setMenuOpen} />
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
            <Route path="*" element={<CreateRecords user={user}/>} />
          </Routes>
        }
      </div>
    </div>
  )
}

const Nav: React.FC<{user:UserRow|null,onLogout:()=>void,menuOpen:boolean,setMenuOpen:(b:boolean)=>void}> = ({user,onLogout,menuOpen,setMenuOpen}) => {
  return (
    <nav className="navbar">
      <div className="brand">Inventory</div>
      <div className="right">
        {user && <>
          <Link to="/">Create Records</Link>
          <Link to="/inventory">Inventory</Link>
          <span className="user">Signed in: {user.username}</span>
          <div className={menuOpen ? 'dropdown open' : 'dropdown'}>
            <button className="btn btn-secondary" onClick={()=>setMenuOpen(!menuOpen)}>More ▾</button>
            <div className="dropdown-menu" onClick={()=>setMenuOpen(false)}>
              <Link to="/records">Records</Link>
              {(user.role==='admin' || user.role==='super_admin') && <Link to="/catalog">Catalog</Link>}
              {(user.role==='admin' || user.role==='super_admin') && <Link to="/threshold">Threshold</Link>}
              <Link to="/monthly-inventory">Monthly Inventory</Link>
              {(user.role==='super_admin' || user.role==='admin') && <Link to="/admin-catalog">Admin-Catalog</Link>}
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
