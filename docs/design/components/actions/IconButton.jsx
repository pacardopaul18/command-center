import React from 'react';
export function IconButton({label,size=32,style,children,...rest}){
  const [hover,setHover]=React.useState(false);
  return <button aria-label={label} title={label} onMouseEnter={()=>setHover(true)} onMouseLeave={()=>setHover(false)}
    style={{width:size,height:size,display:'inline-flex',alignItems:'center',justifyContent:'center',background:hover?'var(--surface-hover)':'transparent',border:'none',borderRadius:'var(--radius-sm)',color:'var(--muted)',cursor:'pointer',transition:'background-color var(--transition-fast)',...style}} {...rest}>{children}</button>;
}
