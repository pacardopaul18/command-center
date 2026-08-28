import React from 'react';
const base={fontFamily:'var(--font-sans)',fontSize:'var(--text-base)',fontWeight:500,borderRadius:'var(--radius-sm)',border:'1px solid transparent',cursor:'pointer',display:'inline-flex',alignItems:'center',gap:8,lineHeight:1,transition:'background-color var(--transition-fast),border-color var(--transition-fast)'};
const variants={
primary:{background:'var(--navy)',color:'var(--text-inverse)'},
secondary:{background:'var(--surface-card)',color:'var(--ink)',borderColor:'var(--border-strong)'},
ghost:{background:'transparent',color:'var(--navy-700)'},
};
const hoverBg={primary:'var(--navy-700)',secondary:'var(--surface-hover)',ghost:'var(--navy-50)'};
const sizes={sm:{padding:'6px 12px',fontSize:'var(--text-sm)'},md:{padding:'9px 16px'}};
export function Button({variant='primary',size='md',disabled=false,style,children,...rest}){
  const [hover,setHover]=React.useState(false);
  const v=variants[variant]||variants.primary;
  return <button disabled={disabled} onMouseEnter={()=>setHover(true)} onMouseLeave={()=>setHover(false)}
    style={{...base,...v,...sizes[size],...(hover&&!disabled?{background:hoverBg[variant]}:{}),...(disabled?{opacity:.45,cursor:'default'}:{}),...style}} {...rest}>{children}</button>;
}
