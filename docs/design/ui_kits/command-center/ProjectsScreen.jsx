import React from 'react';
const DS=()=>window.CommandCenterDesignSystem_a34f56;
const PHASES=['Initiating','Planning','Executing','Monitoring','Closing'];
const PROJECTS=[
 {name:'Onboarding program design',client:'Meridian Health',phase:'Planning',status:'atrisk',milestone:'Signed SOW · Sep 2'},
 {name:'Ops retainer',client:'Halcyon Labs',phase:'Executing',status:'ontrack',milestone:'Monthly review · Sep 12'},
 {name:'Discovery engagement',client:'Northgate Partners',phase:'Executing',status:'atrisk',milestone:'Discovery report · Sep 4'},
 {name:'Compliance audit',client:'Beacon and Cole',phase:'Monitoring',status:'waiting',milestone:'Data export received'},
 {name:'Q2 process review',client:'Halcyon Labs',phase:'Closing',status:'done',milestone:'Final readout · done'},
];
export function ProjectsScreen({onOpenProject}){
  const {StatusChip,Button}=DS();
  const plus=<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M12 5v14M5 12h14"/></svg>;
  return <div>
    <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',marginBottom:20}}>
      <div>
        <h1 style={{margin:0,fontSize:'var(--text-2xl)',fontWeight:700}}>Projects</h1>
        <p style={{margin:'4px 0 0',fontSize:'var(--text-base)',color:'var(--text-secondary)'}}>Your engagements from initiation to closing.</p>
      </div>
      <Button>{plus}New project</Button>
    </div>
    {PHASES.map(ph=>{
      const rows=PROJECTS.filter(p=>p.phase===ph);
      return <div key={ph} style={{marginBottom:20}}>
        <div style={{fontFamily:'var(--font-mono)',fontSize:'var(--text-xs)',letterSpacing:'var(--tracking-label)',textTransform:'uppercase',color:'var(--text-secondary)',marginBottom:8}}>{ph} ({rows.length})</div>
        {rows.length?rows.map(p=><ProjectRow key={p.name} p={p} onOpen={()=>onOpenProject&&onOpenProject(p)}/>)
          :<div style={{display:'flex',alignItems:'center',gap:12,padding:'2px 0 2px 12px'}}><span style={{fontSize:'var(--text-sm)',color:'var(--text-secondary)'}}>Nothing here yet. Start your next engagement.</span><Button size="sm">{plus}New project</Button></div>}
      </div>;
    })}
  </div>;
}
function ProjectRow({p,onOpen}){
  const {StatusChip}=DS();
  const [hover,setHover]=React.useState(false);
  return <div onClick={onOpen} onMouseEnter={()=>setHover(true)} onMouseLeave={()=>setHover(false)}
    style={{display:'grid',gridTemplateColumns:'2fr 1.2fr 1.4fr auto',gap:16,alignItems:'center',background:hover?'var(--surface-hover)':'var(--surface-card)',border:'1px solid var(--border-thin)',borderRadius:'var(--radius-md)',boxShadow:'var(--shadow-card)',padding:'12px 16px',marginBottom:8,cursor:'pointer',transition:'background-color var(--transition-fast)'}}>
    <div style={{fontSize:'var(--text-base)',fontWeight:500}}>{p.name}</div>
    <div style={{fontSize:'var(--text-base)',color:'var(--text-secondary)'}}>{p.client}</div>
    <div style={{fontFamily:'var(--font-mono)',fontSize:'var(--text-xs)',color:'var(--text-secondary)'}}>{p.milestone}</div>
    <StatusChip status={p.status}/>
  </div>;
}
