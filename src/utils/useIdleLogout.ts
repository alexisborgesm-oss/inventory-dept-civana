import { useEffect, useRef } from 'react'

export function useIdleLogout(onIdle: ()=>void, minutes=15){
  const timer = useRef<number | null>(null)
  const reset = () => {
    if (timer.current) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => onIdle(), minutes*60*1000)
  }
  useEffect(()=>{
    const events = ['mousemove','keydown','click','scroll','touchstart']
    events.forEach(e=>window.addEventListener(e, reset, { passive:true }))
    reset()
    return ()=>{
      if (timer.current) window.clearTimeout(timer.current)
      events.forEach(e=>window.removeEventListener(e, reset as any))
    }
  }, [minutes])
}
