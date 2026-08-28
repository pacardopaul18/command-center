import React from 'react';
const DS=()=>window.CommandCenterDesignSystem_a34f56;
const CLIENTS=[
 {id:0,name:'Meridian Health',contacts:[['Dana Okafor','Sponsor, VP Operations'],['Sam Reyes','Finance']],terms:'Net 30 · monthly billing',notes:'Prefers written summaries before calls. Legal review adds about a week to any contract step.',
  projects:[{t:'Onboarding program design',m:'Planning',s:'atrisk'}],
  invoices:[{t:'INV-2041',m:'$12,400 · outstanding 18 days',s:'open'}],
  meetings:[{t:'Meridian phase review',m:'Aug 29, 14:00'},{t:'Kickoff planning',m:'Aug 26'}]},
 {id:1,name:'Halcyon Labs',contacts:[['Priya Nair','COO']],terms:'Net 15 · retainer',notes:'Fast payer. Weekly sync every Friday 09:30.',
  projects:[{t:'Ops retainer',m:'Executing',s:'ontrack'},{t:'Q2 process review',m:'Closing',s:'done'}],
  invoices:[{t:'INV-2043',m:'$6,250 · outstanding 9 days',s:'open'},{t:'INV-2032',m:'$8,400 · paid',s:'done'}],
  meetings:[{t:'Halcyon weekly sync',m:'Aug 29, 09:30'}]},
 {id:2,name:'Northgate Partners',contacts:[['Tom Ellison','Managing Partner']],terms:'Net 30 · milestone billing',notes:'Slow AP process; invoice reminders go to Tom directly.',
  projects:[{t:'Discovery engagement',m:'Executing',s:'atrisk'}],
  invoices:[{t:'INV-2036',m:'$8,200 · outstanding 64 days',s:'overdue'}],
  meetings:[{t:'Discovery readout prep',m:'Aug 25'}]},
 {id:3,name:'Beacon and Cole',contacts:[['Ana Ruiz','Compliance Lead']],terms:'Net 45 · monthly billing',notes:'Waiting on their data export since Aug 21.',
  projects:[{t:'Compliance audit',m:'Monitoring',s:'waiting'}],
  invoices:[{t:'INV-2038',m:'$4,100 · outstanding 34 days',s:'open'}],
  meetings:[]},
];
export function ClientsScreen({onNavigate}){
  const {Card,StatusChip,Button,RelatedPanel}=DS();
  const plus=<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M12 5v14M5 12h14"/></svg>;
  const person=<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8z"/></svg>;
  const [sel,setSel]=React.useState(0);
  const c=CLIENTS[sel];
  return <div>
    <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',marginBottom:20}}>
      <div>
        <h1 style={{margin:0,fontSize:'var(--text-2xl)',fontWeight:700}}>Clients</h1>
        <p style={{margin:'4px 0 0',fontSize:'var(--text-base)',color:'var(--text-secondary)'}}>Who you work with, and everything connected to them.</p>
      </div>
      <Button>{plus}New client</Button>
    </div>
    <div style={{display:'grid',gridTemplateColumns:'300px 1fr 320px',gap:16,alignItems:'start'}}>
      <div style={{background:'var(--surface-card)',border:'1px solid var(--border-thin)',borderRadius:'var(--radius-md)',boxShadow:'var(--shadow-card)',padding:8}}>
        {CLIENTS.map((cl,i)=><ClientRow key={cl.id} c={cl} active={i===sel} onClick={()=>setSel(i)}/>)}
      </div>
      <Card icon={person} title={c.name}>
        <div style={{fontFamily:'var(--font-mono)',fontSize:'var(--text-xs)',letterSpacing:'var(--tracking-label)',textTransform:'uppercase',color:'var(--text-secondary)',marginBottom:6}}>Key contacts</div>
        {c.contacts.map(([n,r])=><div key={n} style={{display:'flex',justifyContent:'space-between',padding:'10px 0',borderBottom:'1px solid var(--border-thin)',fontSize:'var(--text-base)'}}>
          <span>{n}</span><span style={{color:'var(--text-secondary)'}}>{r}</span>
        </div>)}
        <div style={{fontFamily:'var(--font-mono)',fontSize:'var(--text-xs)',letterSpacing:'var(--tracking-label)',textTransform:'uppercase',color:'var(--text-secondary)',margin:'18px 0 6px'}}>Billing terms</div>
        <div style={{fontFamily:'var(--font-mono)',fontSize:'var(--text-sm)'}}>{c.terms}</div>
        <div style={{fontFamily:'var(--font-mono)',fontSize:'var(--text-xs)',letterSpacing:'var(--tracking-label)',textTransform:'uppercase',color:'var(--text-secondary)',margin:'18px 0 6px'}}>Notes</div>
        <p style={{margin:0,fontSize:'var(--text-base)',lineHeight:1.6}}>{c.notes}</p>
      </Card>
      <RelatedPanel sections={[
        {label:'Projects',count:c.projects.length,rows:c.projects.map(p=>({title:p.t,meta:p.m+' phase',trailing:<StatusChip status={p.s}/>,onOpen:()=>onNavigate&&onNavigate('projects')}))},
        {label:'Invoices',count:c.invoices.length,rows:c.invoices.map(iv=>({title:iv.t,meta:iv.m,trailing:<StatusChip status={iv.s} label={iv.s==='done'?'paid':undefined}/>,onOpen:()=>onNavigate&&onNavigate('invoicing')}))},
        {label:'Meetings',count:c.meetings.length,rows:c.meetings.map(mt=>({title:mt.t,meta:mt.m,onOpen:()=>onNavigate&&onNavigate('meetings')})),empty:'No meetings logged yet.'},
      ]}/>
    </div>
  </div>;
}
function ClientRow({c,active,onClick}){
  const [hover,setHover]=React.useState(false);
  return <div onClick={onClick} onMouseEnter={()=>setHover(true)} onMouseLeave={()=>setHover(false)}
    style={{padding:'11px 12px',borderRadius:'var(--radius-sm)',cursor:'pointer',background:active?'var(--navy-50)':hover?'var(--surface-hover)':'transparent',transition:'background-color var(--transition-fast)'}}>
    <div style={{fontSize:'var(--text-base)',fontWeight:active?500:400}}>{c.name}</div>
    <div style={{fontFamily:'var(--font-mono)',fontSize:'var(--text-xs)',color:'var(--text-secondary)',marginTop:3}}>{c.projects.length} project{c.projects.length>1?'s':''} · {c.terms.split(' · ')[0]}</div>
  </div>;
}
