import React from 'react';
const DS=()=>window.CommandCenterDesignSystem_a34f56;
const ITEMS=[
 {title:'Confirm kickoff agenda with Meridian',owner:'Me',context:'Meridian Health · Onboarding',due:'Aug 28',status:'overdue',source:'Meeting'},
 {title:'Send weekly status to Halcyon',owner:'Me',context:'Halcyon Labs · Retainer',due:'Aug 29',status:'open',source:'Manual'},
 {title:'Approve subcontractor hours',owner:'Me',context:'Internal',due:'Aug 29',status:'open',source:'Email'},
 {title:'Send revised SOW to Meridian',owner:'Me',context:'Meridian Health · Onboarding',due:'Sep 2',status:'atrisk',source:'Meeting'},
 {title:'Northgate discovery report draft',owner:'Me',context:'Northgate Partners · Discovery',due:'Sep 4',status:'atrisk',source:'Meeting'},
 {title:'Waiting on Beacon data export',owner:'Beacon',context:'Beacon and Cole · Audit',due:'Sep 5',status:'waiting',source:'Email'},
 {title:'Reconcile August hours',owner:'Me',context:'Internal · Billing',due:'Sep 5',status:'open',source:'Manual'},
 {title:'File onboarding SOP update',owner:'Me',context:'Internal · SOPs',due:'Aug 26',status:'done',source:'Meeting'},
];
const VIEWS=['All','Overdue','Due today','Waiting on','By project'];
export function ActionItemsScreen(){
  const {DataTable,StatusChip,Button,IconButton}=DS();
  const [view,setView]=React.useState('All');
  const rows=ITEMS.filter(r=>view==='Overdue'?r.status==='overdue':view==='Due today'?r.due==='Aug 29':view==='Waiting on'?r.status==='waiting':true);
  const link=<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>;
  const plus=<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M12 5v14M5 12h14"/></svg>;
  return <div>
    <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',marginBottom:20}}>
      <div>
        <h1 style={{margin:0,fontSize:'var(--text-2xl)',fontWeight:700}}>Action items</h1>
        <p style={{margin:'4px 0 0',fontSize:'var(--text-base)',color:'var(--text-secondary)'}}>Every commitment from your meetings, tracked to done.</p>
      </div>
      <Button>{plus}New action item</Button>
    </div>
    <div style={{display:'flex',gap:4,marginBottom:16,borderBottom:'1px solid var(--border-thin)'}}>
      {VIEWS.map(v=><button key={v} onClick={()=>setView(v)} style={{fontFamily:'var(--font-sans)',fontSize:'var(--text-base)',padding:'8px 12px',border:'none',background:'transparent',cursor:'pointer',color:v===view?'var(--navy)':'var(--text-secondary)',fontWeight:v===view?500:400,borderBottom:v===view?'2px solid var(--navy)':'2px solid transparent',marginBottom:-1}}>{v}</button>)}
    </div>
    <div style={{background:'var(--surface-card)',border:'1px solid var(--border-thin)',borderRadius:'var(--radius-md)',boxShadow:'var(--shadow-card)',padding:'4px 8px 8px'}}>
      <DataTable columns={[
        {header:'Title',key:'title',grow:true},
        {header:'Owner',key:'owner',muted:true},
        {header:'Context',key:'context',muted:true},
        {header:'Deadline',key:'due',mono:true},
        {header:'Status',render:r=><StatusChip status={r.status}/>},
        {header:'Source',key:'source',muted:true},
        {header:'',render:()=><IconButton label="Open in Asana" size={26}>{link}</IconButton>,align:'right'},
      ]} rows={rows} onRowClick={()=>{}}/>
      {!rows.length&&<div style={{padding:'28px 12px',textAlign:'center'}}>
        <p style={{margin:'0 0 14px',fontSize:'var(--text-base)',color:'var(--text-secondary)'}}>No action items in this view yet. Add your first one to get started.</p>
        <Button>{plus}New action item</Button>
      </div>}
    </div>
  </div>;
}
