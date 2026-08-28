import React from 'react';
export function Select({options=[],style,...rest}){
  const [focus,setFocus]=React.useState(false);
  return <select onFocus={()=>setFocus(true)} onBlur={()=>setFocus(false)}
    style={{fontFamily:'var(--font-sans)',fontSize:'var(--text-base)',color:'var(--ink)',background:'var(--surface-card)',border:'1px solid var(--border-strong)',borderRadius:'var(--radius-sm)',padding:'8px 12px',outline:'none',width:'100%',boxSizing:'border-box',appearance:'auto',transition:'box-shadow var(--transition-fast)',...(focus?{boxShadow:'var(--focus-ring)',borderColor:'var(--navy-500)'}:{}),...style}} {...rest}>
    {options.map(o=>typeof o==='string'?<option key={o} value={o}>{o}</option>:<option key={o.value} value={o.value}>{o.label}</option>)}
  </select>;
}
