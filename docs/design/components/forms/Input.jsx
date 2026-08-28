import React from 'react';
const ctl={fontFamily:'var(--font-sans)',fontSize:'var(--text-base)',color:'var(--ink)',background:'var(--surface-card)',border:'1px solid var(--border-strong)',borderRadius:'var(--radius-sm)',padding:'8px 12px',outline:'none',width:'100%',boxSizing:'border-box',transition:'box-shadow var(--transition-fast),border-color var(--transition-fast)'};
export function Input({mono=false,style,...rest}){
  const [focus,setFocus]=React.useState(false);
  return <input onFocus={()=>setFocus(true)} onBlur={()=>setFocus(false)}
    style={{...ctl,...(mono?{fontFamily:'var(--font-mono)'}:{}),...(focus?{boxShadow:'var(--focus-ring)',borderColor:'var(--navy-500)'}:{}),...style}} {...rest}/>;
}
