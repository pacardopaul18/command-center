import React from 'react';
export function Card({title,icon,action,callout=false,padding=20,style,children}){
  return <section style={{background:callout?'var(--surface-callout)':'var(--surface-card)',border:'1px solid var(--border-thin)',borderRadius:'var(--radius-md)',boxShadow:callout?'none':'var(--shadow-card)',padding,...style}}>
    {(title||action)&&<header style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:12}}>
      {title&&<h3 style={{margin:0,fontSize:'var(--text-md)',fontWeight:700,color:'var(--ink)',display:'flex',alignItems:'center',gap:8}}>{icon&&<span style={{display:'inline-flex',color:'var(--navy-500)'}}>{icon}</span>}{title}</h3>}
      {action}
    </header>}
    {children}
  </section>;
}
