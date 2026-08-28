import React from 'react';
function NavItem({item,active,onClick}){
  const [hover,setHover]=React.useState(false);
  return <button onClick={onClick} onMouseEnter={()=>setHover(true)} onMouseLeave={()=>setHover(false)}
    style={{display:'flex',alignItems:'center',gap:10,width:'100%',textAlign:'left',padding:'8px 12px',borderRadius:'var(--radius-sm)',border:'none',cursor:'pointer',fontFamily:'var(--font-sans)',fontSize:'var(--text-base)',fontWeight:active?500:400,color:active?'#FFFFFF':'var(--text-inverse-muted)',background:active?'rgba(255,255,255,.16)':hover?'rgba(255,255,255,.06)':'transparent',transition:'background-color var(--transition-fast),color var(--transition-fast)'}}>
    {item.icon&&<span style={{display:'inline-flex',width:16,height:16,alignItems:'center',justifyContent:'center'}}>{item.icon}</span>}
    {item.label}
  </button>;
}
export function Sidebar({appName='Command Center',items=[],activeId,onNavigate,onQuickAdd,footer,style}){
  return <nav style={{width:'var(--sidebar-width)',minWidth:'var(--sidebar-width)',background:'var(--surface-sidebar)',color:'var(--text-inverse)',display:'flex',flexDirection:'column',padding:'20px 12px',boxSizing:'border-box',minHeight:'100%',...style}}>
    <div style={{fontWeight:700,fontSize:'var(--text-md)',color:'#FFFFFF',padding:'0 12px',marginBottom:20}}>{appName}</div>
    {onQuickAdd&&<button onClick={onQuickAdd} style={{display:'flex',alignItems:'center',justifyContent:'space-between',margin:'0 0 16px',padding:'10px 12px',borderRadius:'var(--radius-sm)',border:'none',background:'#FFFFFF',color:'var(--navy)',fontFamily:'var(--font-sans)',fontSize:'var(--text-base)',fontWeight:500,cursor:'pointer',boxShadow:'0 1px 3px rgba(0,0,0,.18)'}}>
      <span style={{display:'inline-flex',alignItems:'center',gap:8}}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14"/></svg>Quick add</span><span style={{fontFamily:'var(--font-mono)',fontSize:'var(--text-xs)',color:'var(--muted)'}}>N</span>
    </button>}
    <div style={{display:'flex',flexDirection:'column',gap:2}}>
      {items.map(it=><NavItem key={it.id} item={it} active={it.id===activeId} onClick={()=>onNavigate&&onNavigate(it.id)}/>)}
    </div>
    <div style={{marginTop:'auto'}}>{footer}</div>
  </nav>;
}
