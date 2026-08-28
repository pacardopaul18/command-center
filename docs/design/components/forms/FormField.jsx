import React from 'react';
export function FormField({label,hint,style,children}){
  return <label style={{display:'block',...style}}>
    <span style={{display:'block',fontFamily:'var(--font-mono)',fontSize:'var(--text-xs)',letterSpacing:'var(--tracking-label)',textTransform:'uppercase',color:'var(--text-secondary)',marginBottom:6}}>{label}</span>
    {children}
    {hint&&<span style={{display:'block',fontSize:'var(--text-sm)',color:'var(--text-secondary)',marginTop:6}}>{hint}</span>}
  </label>;
}
