import React from 'react';
const DS=()=>window.CommandCenterDesignSystem_a34f56;
const MEETINGS=[
 {id:0,title:'Halcyon weekly sync',client:'Halcyon Labs',date:'Aug 29, 09:30',recorded:true,
  summary:'Reviewed sprint progress and the September review agenda. Halcyon confirmed budget for the ops retainer through Q4. Two follow-ups extracted.',
  items:[{t:'Send weekly status to Halcyon',due:'Aug 29',status:'open'},{t:'Draft Q4 retainer renewal note',due:'Sep 3',status:'open'}],
  project:'Ops retainer'},
 {id:1,title:'Meridian phase review',client:'Meridian Health',date:'Aug 29, 14:00',recorded:false,
  summary:'Agenda drafted. SOW signature is the open blocker; legal review has not moved in five days.',
  items:[{t:'Send revised SOW to Meridian',due:'Sep 2',status:'atrisk'}],
  project:'Onboarding program design'},
 {id:2,title:'Kickoff planning with Meridian',client:'Meridian Health',date:'Aug 26, 10:00',recorded:true,
  summary:'Confirmed stakeholder map and success criteria. Kickoff pending signed SOW. Two action items extracted.',
  items:[{t:'Confirm kickoff agenda with Meridian',due:'Aug 28',status:'overdue'},{t:'Draft stakeholder brief',due:'Aug 22',status:'done'}],
  project:'Onboarding program design'},
 {id:3,title:'Northgate discovery readout prep',client:'Northgate Partners',date:'Aug 25, 15:00',recorded:true,
  summary:'Walked the draft findings. Report is 40 percent done against a Sep 4 milestone.',
  items:[{t:'Northgate discovery report draft',due:'Sep 4',status:'atrisk'}],
  project:'Discovery engagement'},
];
export function MeetingsScreen({onNavigate}){
  const {Card,StatusChip,Button,IconButton,RelatedPanel}=DS();
  const [sel,setSel]=React.useState(0);
  const m=MEETINGS[sel];
  const play=<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="m10 8 6 4-6 4V8z"/></svg>;
  const plus=<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M12 5v14M5 12h14"/></svg>;
  const smallPlus=<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M12 5v14M5 12h14"/></svg>;
  const video=<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M16 10l6-4v12l-6-4M2 8a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8z"/></svg>;
  return <div>
    <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',marginBottom:20}}>
      <div>
        <h1 style={{margin:0,fontSize:'var(--text-2xl)',fontWeight:700}}>Meetings</h1>
        <p style={{margin:'4px 0 0',fontSize:'var(--text-base)',color:'var(--text-secondary)'}}>Every conversation, captured with its follow-ups.</p>
      </div>
      <Button>{plus}Log meeting</Button>
    </div>
    <div style={{display:'grid',gridTemplateColumns:'380px 1fr',gap:16,alignItems:'start'}}>
      <div style={{background:'var(--surface-card)',border:'1px solid var(--border-thin)',borderRadius:'var(--radius-md)',boxShadow:'var(--shadow-card)',padding:8}}>
        {MEETINGS.map((mt,i)=><MeetingRow key={mt.id} m={mt} active={i===sel} onClick={()=>setSel(i)}/>)}
      </div>
      <div style={{display:'grid',gridTemplateColumns:'1fr 320px',gap:16,alignItems:'start'}}>
        <Card icon={video} title={m.title} action={m.recorded?<Button variant="ghost" size="sm">{play}Recording</Button>:<span style={{fontFamily:'var(--font-mono)',fontSize:'var(--text-xs)',color:'var(--text-secondary)'}}>not recorded</span>}>
          <div style={{fontFamily:'var(--font-mono)',fontSize:'var(--text-xs)',color:'var(--text-secondary)',marginBottom:12}}>{m.date} · {m.client}</div>
          <div style={{fontFamily:'var(--font-mono)',fontSize:'var(--text-xs)',letterSpacing:'var(--tracking-label)',textTransform:'uppercase',color:'var(--text-secondary)',marginBottom:6}}>AI summary</div>
          <p style={{margin:'0 0 20px',fontSize:'var(--text-base)',lineHeight:1.6}}>{m.summary}</p>
          <div style={{fontFamily:'var(--font-mono)',fontSize:'var(--text-xs)',letterSpacing:'var(--tracking-label)',textTransform:'uppercase',color:'var(--text-secondary)',marginBottom:4}}>Extracted action items</div>
          {m.items.map(it=><div key={it.t} style={{display:'flex',alignItems:'center',gap:12,padding:'12px 0',borderBottom:'1px solid var(--border-thin)'}}>
            <span style={{flex:1,fontSize:'var(--text-base)'}}>{it.t}</span>
            <span style={{fontFamily:'var(--font-mono)',fontSize:'var(--text-xs)',color:'var(--text-secondary)'}}>Due {it.due}</span>
            <StatusChip status={it.status}/>
            <IconButton label="Create action item" size={28}>{smallPlus}</IconButton>
          </div>)}
        </Card>
        <RelatedPanel sections={[
          {label:'Project',count:1,rows:[{title:m.project,meta:m.client,onOpen:()=>onNavigate&&onNavigate('projects')}]},
          {label:'Action items',count:m.items.length,rows:m.items.map(it=>({title:it.t,meta:'Due '+it.due,trailing:<StatusChip status={it.status}/>,onOpen:()=>onNavigate&&onNavigate('actions')}))},
          {label:'Client',count:1,rows:[{title:m.client,meta:'Client record',onOpen:()=>onNavigate&&onNavigate('clients')}]},
        ]}/>
      </div>
    </div>
  </div>;
}
function MeetingRow({m,active,onClick}){
  const {StatusChip}=DS();
  const [hover,setHover]=React.useState(false);
  const risky=m.items.some(i=>i.status==='atrisk'||i.status==='overdue');
  return <div onClick={onClick} onMouseEnter={()=>setHover(true)} onMouseLeave={()=>setHover(false)}
    style={{padding:'12px 12px',borderRadius:'var(--radius-sm)',cursor:'pointer',background:active?'var(--navy-50)':hover?'var(--surface-hover)':'transparent',transition:'background-color var(--transition-fast)'}}>
    <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:8}}>
      <span style={{fontSize:'var(--text-base)',fontWeight:active?500:400}}>{m.title}</span>
      {risky&&<StatusChip status="atrisk"/>}
    </div>
    <div style={{fontFamily:'var(--font-mono)',fontSize:'var(--text-xs)',color:'var(--text-secondary)',marginTop:3}}>{m.date} · {m.client} · {m.items.length} action item{m.items.length>1?'s':''}</div>
  </div>;
}
