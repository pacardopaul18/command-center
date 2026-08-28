import React from 'react';
const DS=()=>window.CommandCenterDesignSystem_a34f56;
function Label({children,style}){return <div style={{fontFamily:'var(--font-mono)',fontSize:'var(--text-xs)',letterSpacing:'var(--tracking-label)',textTransform:'uppercase',color:'var(--text-secondary)',...style}}>{children}</div>;}
function Row({title,meta,chip,gold}){
  const [hover,setHover]=React.useState(false);
  return <div onMouseEnter={()=>setHover(true)} onMouseLeave={()=>setHover(false)} style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:12,padding:'9px 10px',borderRadius:'var(--radius-sm)',background:hover?'var(--surface-hover)':'transparent',cursor:'pointer',borderLeft:gold?'2px solid var(--gold)':'2px solid transparent'}}>
    <div style={{minWidth:0}}>
      <div style={{fontSize:'var(--text-base)',color:'var(--ink)',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{title}</div>
      <div style={{fontFamily:'var(--font-mono)',fontSize:'var(--text-xs)',color:'var(--text-secondary)',marginTop:2}}>{meta}</div>
    </div>
    {chip}
  </div>;
}
export function TodayScreen({onNavigate}){
  const {Card,StatusChip,Button,Input}=DS();
  const ic=d=><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d={d}/></svg>;
  return <div>
    <div style={{display:'flex',alignItems:'baseline',justifyContent:'space-between',marginBottom:2}}>
      <h1 style={{margin:0,fontSize:'var(--text-2xl)',fontWeight:700}}>Good morning, Paul</h1>
      <span style={{fontFamily:'var(--font-mono)',fontSize:'var(--text-sm)',color:'var(--text-secondary)'}}>Fri, Aug 29</span>
    </div>
    <p style={{margin:'0 0 20px',fontSize:'var(--text-base)',color:'var(--text-secondary)'}}>Three items need your attention and one invoice is past 60 days. Halcyon is <span style={{color:'var(--green)'}}>on track</span>.</p>
    <div style={{display:'flex',gap:8,marginBottom:24,maxWidth:640}}>
      <Input placeholder="Add an action item, meeting note, or reminder"/>
      <Button style={{whiteSpace:'nowrap'}}>Quick add</Button>
    </div>
    <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16}}>
      <Card icon={ic('M12 6v6l4 2M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z')} title="Overdue and due today" action={<Button variant="ghost" size="sm" onClick={()=>onNavigate&&onNavigate('actions')}>Open tracker</Button>} padding={14}>
        <Row gold title="Confirm kickoff agenda with Meridian" meta="Due Aug 28 · Meridian Health" chip={<StatusChip status="overdue"/>}/>
        <Row title="Send weekly status to Halcyon" meta="Due today · Halcyon Labs" chip={<StatusChip status="open"/>}/>
        <Row title="Approve subcontractor hours" meta="Due today · Internal" chip={<StatusChip status="open"/>}/>
      </Card>
      <Card icon={ic('M10.3 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.7 3.86a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01')} title="What will slip" padding={14}>
        <Row gold title="Revised SOW waiting on legal review" meta="No movement for 5 days · Meridian Health" chip={<StatusChip status="atrisk"/>}/>
        <Row gold title="Northgate discovery report draft" meta="Milestone Sep 4, 40% done" chip={<StatusChip status="atrisk"/>}/>
        <Row title="Waiting on Beacon data export" meta="Requested Aug 21" chip={<StatusChip status="waiting"/>}/>
      </Card>
      <Card icon={ic('M16 10l6-4v12l-6-4M2 8a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8z')} title="Today's meetings" action={<Button variant="ghost" size="sm" onClick={()=>onNavigate&&onNavigate('meetings')}>Meetings log</Button>} padding={14}>
        <Row title="Halcyon weekly sync" meta="09:30 · recurring · 4 open follow-ups" chip={<span style={{fontFamily:'var(--font-mono)',fontSize:'var(--text-xs)',color:'var(--text-secondary)'}}>09:30</span>}/>
        <Row title="Meridian phase review" meta="14:00 · agenda drafted" chip={<span style={{fontFamily:'var(--font-mono)',fontSize:'var(--text-xs)',color:'var(--text-secondary)'}}>14:00</span>}/>
      </Card>
      <Card icon={ic('M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6')} title="Invoice alerts" action={<Button variant="ghost" size="sm" onClick={()=>onNavigate&&onNavigate('invoicing')}>Invoicing</Button>} padding={14}>
        <Row gold title="Northgate Partners INV-2036" meta="$8,200 outstanding · 64 days" chip={<StatusChip status="overdue" label="61 to 90"/>}/>
        <Row title="Meridian Health INV-2041" meta="$12,400 outstanding · 18 days" chip={<StatusChip status="open" label="0 to 30"/>}/>
      </Card>
    </div>
  </div>;
}
