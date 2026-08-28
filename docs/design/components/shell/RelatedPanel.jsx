import React from 'react';
function LinkRow({row,onOpen}){
  const [hover,setHover]=React.useState(false);
  return <button onClick={onOpen} onMouseEnter={()=>setHover(true)} onMouseLeave={()=>setHover(false)}
    style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:12,width:'100%',textAlign:'left',padding:'8px 10px',border:'none',borderRadius:'var(--radius-sm)',background:hover?'var(--surface-hover)':'transparent',cursor:'pointer',fontFamily:'var(--font-sans)',transition:'background-color var(--transition-fast)'}}>
    <span style={{minWidth:0}}>
      <span style={{display:'block',fontSize:'var(--text-base)',color:'var(--text-link)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{row.title}</span>
      {row.meta&&<span style={{display:'block',fontFamily:'var(--font-mono)',fontSize:'var(--text-xs)',color:'var(--text-secondary)',marginTop:2}}>{row.meta}</span>}
    </span>
    {row.trailing}
  </button>;
}
export function RelatedPanel({sections=[],style}){
  return <aside style={{background:'var(--surface-card)',border:'1px solid var(--border-thin)',borderRadius:'var(--radius-md)',boxShadow:'var(--shadow-card)',padding:16,boxSizing:'border-box',...style}}>
    <h3 style={{margin:'0 0 4px',fontSize:'var(--text-md)',fontWeight:700}}>Related</h3>
    {sections.map((s,i)=><div key={i} style={{marginTop:12}}>
      <div style={{fontFamily:'var(--font-mono)',fontSize:'var(--text-xs)',letterSpacing:'var(--tracking-label)',textTransform:'uppercase',color:'var(--text-secondary)',padding:'0 10px',marginBottom:4}}>{s.label}{typeof s.count==='number'&&<span> ({s.count})</span>}</div>
      {s.rows&&s.rows.length?s.rows.map((r,j)=><LinkRow key={j} row={r} onOpen={r.onOpen}/>)
        :<div style={{fontSize:'var(--text-sm)',color:'var(--text-secondary)',padding:'2px 10px'}}>{s.empty||'Nothing linked yet.'}</div>}
    </div>)}
  </aside>;
}
