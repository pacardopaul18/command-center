import React from 'react';
const DS=()=>window.CommandCenterDesignSystem_a34f56;
const SOPS=[
 {cat:'Client delivery',items:[
   {title:'Project kickoff checklist',v:'v4',updated:'Aug 12, 2026',sel:true},
   {title:'Weekly status report format',v:'v2',updated:'Jul 30, 2026'},
   {title:'Phase gate review',v:'v3',updated:'Jun 18, 2026'}]},
 {cat:'Billing',items:[
   {title:'Monthly invoicing run',v:'v5',updated:'Aug 2, 2026'},
   {title:'Aging follow-up cadence',v:'v1',updated:'May 9, 2026'}]},
 {cat:'Internal',items:[
   {title:'Meeting capture and follow-up',v:'v2',updated:'Aug 20, 2026'},
   {title:'New client onboarding',v:'v3',updated:'Jul 11, 2026'}]},
];
const HISTORY=[
 {v:'v4',date:'Aug 12, 2026',note:'Added SOW signature gate before kickoff.',current:true},
 {v:'v3',date:'May 28, 2026',note:'Merged stakeholder map into step 2.'},
 {v:'v2',date:'Feb 14, 2026',note:'Added recording setup step.'},
 {v:'v1',date:'Nov 3, 2025',note:'First written version.'},
];
export function SopsScreen(){
  const {Card,Input,Button}=DS();
  const plus=<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M12 5v14M5 12h14"/></svg>;
  const book=<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20M4 19.5A2.5 2.5 0 0 0 6.5 22H20V2H6.5A2.5 2.5 0 0 0 4 4.5v15z"/></svg>;
  const history=<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 3"/></svg>;
  const [sel,setSel]=React.useState('Project kickoff checklist');
  return <div>
    <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',marginBottom:20}}>
      <div>
        <h1 style={{margin:0,fontSize:'var(--text-2xl)',fontWeight:700}}>SOPs</h1>
        <p style={{margin:'4px 0 0',fontSize:'var(--text-base)',color:'var(--text-secondary)'}}>How the work gets done, written down and current.</p>
      </div>
      <Button>{plus}New SOP</Button>
    </div>
    <div style={{display:'grid',gridTemplateColumns:'320px 1fr 280px',gap:16,alignItems:'start'}}>
      <div>
        <Input placeholder="Search SOPs" style={{marginBottom:12}}/>
        {SOPS.map(g=><div key={g.cat} style={{marginBottom:16}}>
          <div style={{fontFamily:'var(--font-mono)',fontSize:'var(--text-xs)',letterSpacing:'var(--tracking-label)',textTransform:'uppercase',color:'var(--text-secondary)',margin:'0 0 4px 10px'}}>{g.cat}</div>
          {g.items.map(s=><SopRow key={s.title} s={s} active={s.title===sel} onClick={()=>setSel(s.title)}/>)}
        </div>)}
      </div>
      <Card icon={book} title="Project kickoff checklist" action={<span style={{fontFamily:'var(--font-mono)',fontSize:'var(--text-xs)',color:'var(--text-secondary)'}}>v4 · Aug 12, 2026</span>}>
        <p style={{margin:'0 0 14px',fontSize:'var(--text-base)',lineHeight:1.6}}>Run this before every engagement moves from Planning to Executing. The SOW must be signed before any kickoff is scheduled.</p>
        <ol style={{margin:0,paddingLeft:20,fontSize:'var(--text-base)',lineHeight:1.6,display:'flex',flexDirection:'column',gap:8}}>
          <li>Confirm the stakeholder map with the client sponsor.</li>
          <li>Verify the SOW is signed and filed in the client record.</li>
          <li>Schedule the kickoff and send the agenda two days ahead.</li>
          <li>Set up the recording and note capture for the kickoff.</li>
          <li>Create the project in Asana from the engagement template.</li>
          <li>Log the first billing period against the project.</li>
        </ol>
      </Card>
      <Card icon={history} title="Version history" padding={14}>
        {HISTORY.map(h=><div key={h.v} style={{padding:'10px 0',borderBottom:'1px solid var(--border-thin)'}}>
          <div style={{display:'flex',justifyContent:'space-between',fontFamily:'var(--font-mono)',fontSize:'var(--text-xs)'}}>
            <span style={{color:h.current?'var(--green)':'var(--ink)'}}>{h.v}{h.current?' · current':''}</span>
            <span style={{color:'var(--text-secondary)'}}>{h.date}</span>
          </div>
          <div style={{fontSize:'var(--text-sm)',color:'var(--text-secondary)',marginTop:3}}>{h.note}</div>
        </div>)}
      </Card>
    </div>
  </div>;
}
function SopRow({s,active,onClick}){
  const [hover,setHover]=React.useState(false);
  return <div onClick={onClick} onMouseEnter={()=>setHover(true)} onMouseLeave={()=>setHover(false)}
    style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:8,padding:'9px 10px',borderRadius:'var(--radius-sm)',cursor:'pointer',background:active?'var(--navy-50)':hover?'var(--surface-hover)':'transparent',transition:'background-color var(--transition-fast)'}}>
    <span style={{fontSize:'var(--text-base)',fontWeight:active?500:400}}>{s.title}</span>
    <span style={{fontFamily:'var(--font-mono)',fontSize:'var(--text-xs)',color:'var(--text-secondary)'}}>{s.v}</span>
  </div>;
}
