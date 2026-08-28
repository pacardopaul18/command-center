import React from 'react';
const DS=()=>window.CommandCenterDesignSystem_a34f56;
const CHECKLIST=[
 {label:'Stakeholder map confirmed',done:true},
 {label:'Scope and success criteria drafted',done:true},
 {label:'SOW signed',done:false,atrisk:true},
 {label:'Kickoff scheduled',done:false},
 {label:'Delivery plan baselined',done:false},
];
export function ProjectDetailScreen({onBack,onNavigate}){
  const {StatusChip,Card,Button,RelatedPanel}=DS();
  const check=<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5"/></svg>;
  return <div>
    <div style={{fontFamily:'var(--font-mono)',fontSize:'var(--text-sm)',color:'var(--text-secondary)',marginBottom:12}}>
      <a onClick={onBack} style={{cursor:'pointer'}}>Projects</a> / Onboarding program design
    </div>
    <div style={{display:'flex',alignItems:'center',gap:12,marginBottom:4}}>
      <h1 style={{margin:0,fontSize:'var(--text-2xl)',fontWeight:700}}>Onboarding program design</h1>
      <StatusChip status="atrisk"/>
    </div>
    <p style={{margin:'0 0 20px',fontSize:'var(--text-base)',color:'var(--text-secondary)'}}>Meridian Health · Planning phase · next milestone Signed SOW, Sep 2</p>
    <div style={{display:'grid',gridTemplateColumns:'1fr 340px',gap:16,alignItems:'start'}}>
      <Card icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>} title="Planning checklist" action={<span style={{fontFamily:'var(--font-mono)',fontSize:'var(--text-xs)',color:'var(--green)'}}>2 of 5 done</span>}>
        {CHECKLIST.map(c=><div key={c.label} style={{display:'flex',alignItems:'center',gap:10,padding:'8px 0',borderBottom:'1px solid var(--border-thin)',fontSize:'var(--text-base)'}}>
          <span style={{width:20,height:20,borderRadius:6,display:'inline-flex',alignItems:'center',justifyContent:'center',border:c.done?'none':'1px solid var(--border-strong)',background:c.done?'var(--green)':'transparent',color:'#fff'}}>{c.done?check:null}</span>
          <span style={{color:c.done?'var(--text-secondary)':'var(--ink)',textDecoration:c.done?'line-through':'none',flex:1}}>{c.label}</span>
          {c.atrisk&&<StatusChip status="atrisk"/>}
        </div>)}
        <div style={{marginTop:14}}><Button variant="secondary" size="sm">Advance to Executing</Button></div>
      </Card>
      <RelatedPanel sections={[
        {label:'Action items',count:3,rows:[
          {title:'Send revised SOW to Meridian',meta:'Due Sep 2',trailing:<StatusChip status="atrisk"/>,onOpen:()=>onNavigate&&onNavigate('actions')},
          {title:'Confirm kickoff agenda',meta:'Due Aug 28',trailing:<StatusChip status="overdue"/>,onOpen:()=>onNavigate&&onNavigate('actions')},
          {title:'Draft stakeholder brief',meta:'Done Aug 22',trailing:<StatusChip status="done"/>,onOpen:()=>onNavigate&&onNavigate('actions')},
        ]},
        {label:'Meetings',count:2,rows:[
          {title:'Kickoff planning with Meridian',meta:'Aug 26 · recorded · 2 action items'},
          {title:'Scope working session',meta:'Aug 19 · recorded'},
        ]},
        {label:'Time',rows:[{title:'August hours',meta:'22.5 h logged · unreconciled'}]},
        {label:'Invoices',count:1,rows:[{title:'INV-2041',meta:'$12,400 · outstanding 18 days',onOpen:()=>onNavigate&&onNavigate('invoicing')}]},
      ]}/>
    </div>
  </div>;
}
