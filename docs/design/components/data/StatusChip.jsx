import React from 'react';
const STYLES={
ontrack:['var(--chip-ontrack-bg)','var(--chip-ontrack-fg)','on track'],
atrisk:['var(--chip-atrisk-bg)','var(--chip-atrisk-fg)','at risk'],
blocked:['var(--chip-blocked-bg)','var(--chip-blocked-fg)','blocked'],
done:['var(--chip-done-bg)','var(--chip-done-fg)','done'],
overdue:['var(--chip-overdue-bg)','var(--chip-overdue-fg)','overdue'],
waiting:['var(--chip-waiting-bg)','var(--chip-waiting-fg)','waiting'],
open:['var(--chip-open-bg)','var(--chip-open-fg)','open'],
};
export function StatusChip({status='open',label,style}){
  const [bg,fg,text]=STYLES[status]||STYLES.open;
  return <span style={{display:'inline-flex',alignItems:'center',background:bg,color:fg,fontFamily:'var(--font-mono)',fontSize:'var(--text-xs)',letterSpacing:'var(--tracking-label)',textTransform:'uppercase',padding:'3px 10px',borderRadius:'var(--radius-pill)',whiteSpace:'nowrap',...style}}>{label||text}</span>;
}
