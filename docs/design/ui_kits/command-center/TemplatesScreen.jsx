import React from 'react';
const DS=()=>window.CommandCenterDesignSystem_a34f56;
const TEMPLATES=[
 {cat:'Replies',items:[
  {title:'Invoice reminder, first touch',tags:['billing','email'],body:'A calm first reminder sent when an invoice passes its terms by a few days.'},
  {title:'Invoice reminder, 60 plus days',tags:['billing','aging','email'],body:'Firm follow-up for invoices past 60 days, copied to the finance contact.'},
  {title:'Meeting follow-up with action items',tags:['meetings','email'],body:'Post-meeting summary that lists extracted action items with owners and dates.'},
  {title:'Scope change acknowledgment',tags:['delivery','email'],body:'Confirms a requested change and points to the SOW amendment step.'}]},
 {cat:'Documents',items:[
  {title:'Weekly status report',tags:['delivery','doc'],body:'One-page status: progress, risks, next milestones, hours used.'},
  {title:'SOW amendment',tags:['contracts','doc'],body:'Standard amendment shell with scope, fee, and timeline fields.'},
  {title:'Project closeout summary',tags:['delivery','doc'],body:'Final readout: outcomes, open items handed off, archive links.'}]},
];
export function TemplatesScreen(){
  const {Card,Button,Input}=DS();
  const plus=<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M12 5v14M5 12h14"/></svg>;
  const doc=<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6"/></svg>;
  return <div>
    <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',marginBottom:20}}>
      <div>
        <h1 style={{margin:0,fontSize:'var(--text-2xl)',fontWeight:700}}>Templates</h1>
        <p style={{margin:'4px 0 0',fontSize:'var(--text-base)',color:'var(--text-secondary)'}}>Ready-made replies and documents, one click to use.</p>
      </div>
      <Button>{plus}New template</Button>
    </div>
    <Input placeholder="Search templates or tags" style={{maxWidth:420,marginBottom:20}}/>
    {TEMPLATES.map(g=><div key={g.cat} style={{marginBottom:24}}>
      <div style={{fontFamily:'var(--font-mono)',fontSize:'var(--text-xs)',letterSpacing:'var(--tracking-label)',textTransform:'uppercase',color:'var(--text-secondary)',marginBottom:10}}>{g.cat}</div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(2,1fr)',gap:12}}>
        {g.items.map(t=><Card key={t.title} padding={16} icon={doc} title={t.title} action={<Button variant="secondary" size="sm">Use</Button>}>
          <p style={{margin:'0 0 10px',fontSize:'var(--text-base)',color:'var(--text-secondary)',lineHeight:1.55}}>{t.body}</p>
          <div style={{display:'flex',gap:6}}>
            {t.tags.map(tag=><span key={tag} style={{fontFamily:'var(--font-mono)',fontSize:'var(--text-xs)',color:'var(--muted)',background:'var(--surface-hover)',padding:'2px 8px',borderRadius:'var(--radius-pill)'}}>{tag}</span>)}
          </div>
        </Card>)}
      </div>
    </div>)}
  </div>;
}
