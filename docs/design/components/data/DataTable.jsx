import React from 'react';
function Row({row,columns,onClick}){
  const [hover,setHover]=React.useState(false);
  return <tr onMouseEnter={()=>setHover(true)} onMouseLeave={()=>setHover(false)} onClick={onClick}
    style={{background:hover?'var(--surface-hover)':'transparent',cursor:onClick?'pointer':'default',transition:'background-color var(--transition-fast)'}}>
    {columns.map((c,i)=><td key={i} style={{padding:'10px 12px',borderTop:'1px solid var(--border-thin)',fontSize:'var(--text-base)',textAlign:c.align||'left',fontFamily:c.mono?'var(--font-mono)':'inherit',color:c.muted?'var(--text-secondary)':'inherit',whiteSpace:'nowrap',...(c.grow?{whiteSpace:'normal',width:'100%'}:{})}}>{c.render?c.render(row):row[c.key]}</td>)}
  </tr>;
}
export function DataTable({columns=[],rows=[],onRowClick,style}){
  return <table style={{borderCollapse:'collapse',width:'100%',...style}}>
    <thead><tr>{columns.map((c,i)=><th key={i} style={{padding:'6px 12px',textAlign:c.align||'left',fontFamily:'var(--font-mono)',fontSize:'var(--text-xs)',fontWeight:500,letterSpacing:'var(--tracking-label)',textTransform:'uppercase',color:'var(--text-secondary)'}}>{c.header}</th>)}</tr></thead>
    <tbody>{rows.map((r,i)=><Row key={i} row={r} columns={columns} onClick={onRowClick?()=>onRowClick(r):undefined}/>)}</tbody>
  </table>;
}
