import React from 'react'
export const Modal: React.FC<{open:boolean,onClose:()=>void,title?:string,children:React.ReactNode,footer?:React.ReactNode}> = ({open,onClose,title,children,footer})=>{
  if(!open) return null
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e=>e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>×</button>
        {title && <h3 style={{marginTop:0}}>{title}</h3>}
        <div>{children}</div>
        {footer && <div style={{marginTop:'.75rem', display:'flex', gap:8, justifyContent:'flex-end'}}>{footer}</div>}
      </div>
    </div>
  )
}
