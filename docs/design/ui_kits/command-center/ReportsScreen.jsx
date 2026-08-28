import React from 'react';
const DS=()=>window.CommandCenterDesignSystem_a34f56;
const REPORTS=[
 {id:'billing',title:'Billing and aging',desc:'Outstanding by client and aging bucket.'},
 {id:'projects',title:'Project status',desc:'Phase and status across all projects.'},
 {id:'followup',title:'Follow-up completion',desc:'Action items closed on time, by week.'},
 {id:'hours',title:'Partner hours saved',desc:'Hours captured by automation each month.'},
];
function Bar({label,value,max,gold}){
  return <div style={{display:'grid',gridTemplateColumns:'150px 1fr 70px',gap:12,alignItems:'center',padding:'7px 0'}}>
    <span style={{fontSize:'var(--text-base)',color:'var(--text-secondary)'}}>{label}</span>
    <div style={{height:8,background:'var(--surface-hover)',borderRadius:999}}>
      <div style={{width:(value/max*100)+'%',height:8,borderRadius:999,background:gold?'var(--gold)':'var(--navy)'}}></div>
    </div>
    <span style={{fontFamily:'var(--font-mono)',fontSize:'var(--text-sm)',textAlign:'right'}}>{'$'+value.toLocaleString()}</span>
  </div>;
}
export function ReportsScreen(){
  const {Card,Button,StatusChip}=DS();
  const [sel,setSel]=React.useState('billing');
  const chart=<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M3 3v18h18M18 17V9M13 17V5M8 17v-3"/></svg>;
  return <div>
    <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',marginBottom:20}}>
      <div>
        <h1 style={{margin:0,fontSize:'var(--text-2xl)',fontWeight:700}}>Reports</h1>
        <p style={{margin:'4px 0 0',fontSize:'var(--text-base)',color:'var(--text-secondary)'}}>The short list of numbers that matter.</p>
      </div>
      <div style={{display:'flex',gap:8}}>
        <Button size="sm" variant="secondary">Export PDF</Button>
        <Button size="sm" variant="ghost">Share read-only link</Button>
      </div>
    </div>
    <div style={{display:'grid',gridTemplateColumns:'300px 1fr',gap:16,alignItems:'start'}}>
      <div style={{background:'var(--surface-card)',border:'1px solid var(--border-thin)',borderRadius:'var(--radius-md)',boxShadow:'var(--shadow-card)',padding:8}}>
        {REPORTS.map(r=><ReportRow key={r.id} r={r} active={r.id===sel} onClick={()=>setSel(r.id)}/>)}
      </div>
      {sel==='billing'&&<Card icon={chart} title="Billing and aging" action={<span style={{fontFamily:'var(--font-mono)',fontSize:'var(--text-xs)',color:'var(--text-secondary)'}}>as of Aug 29, 2026</span>}>
        <div style={{display:'flex',gap:24,marginBottom:18}}>
          <div><div style={{fontFamily:'var(--font-mono)',fontSize:'var(--text-xs)',letterSpacing:'var(--tracking-label)',textTransform:'uppercase',color:'var(--text-secondary)'}}>Total outstanding</div><div style={{fontFamily:'var(--font-mono)',fontSize:'var(--text-xl)',fontWeight:500,marginTop:4}}>$30,950</div></div>
          <div><div style={{fontFamily:'var(--font-mono)',fontSize:'var(--text-xs)',letterSpacing:'var(--tracking-label)',textTransform:'uppercase',color:'var(--gold-600)'}}>Past 60 days</div><div style={{fontFamily:'var(--font-mono)',fontSize:'var(--text-xl)',fontWeight:500,marginTop:4,color:'var(--gold-600)'}}>$8,200</div></div>
        </div>
        <div style={{fontFamily:'var(--font-mono)',fontSize:'var(--text-xs)',letterSpacing:'var(--tracking-label)',textTransform:'uppercase',color:'var(--text-secondary)',marginBottom:4}}>Outstanding by client</div>
        <Bar label="Meridian Health" value={12400} max={12400}/>
        <Bar label="Northgate Partners" value={8200} max={12400} gold/>
        <Bar label="Halcyon Labs" value={6250} max={12400}/>
        <Bar label="Beacon and Cole" value={4100} max={12400}/>
        <p style={{margin:'14px 0 0',fontSize:'var(--text-sm)',color:'var(--text-secondary)'}}>Gold marks balances past 60 days. Rows trace to invoices and their billing periods.</p>
      </Card>}
      {sel==='projects'&&<Card icon={chart} title="Project status" action={<span style={{fontFamily:'var(--font-mono)',fontSize:'var(--text-xs)',color:'var(--text-secondary)'}}>as of Aug 29, 2026</span>}>
        {[['Onboarding program design','Planning','atrisk'],['Ops retainer','Executing','ontrack'],['Discovery engagement','Executing','atrisk'],['Compliance audit','Monitoring','waiting'],['Q2 process review','Closing','done']].map(([n,ph,s])=>
          <div key={n} style={{display:'grid',gridTemplateColumns:'1fr 120px auto',gap:12,alignItems:'center',padding:'11px 0',borderBottom:'1px solid var(--border-thin)'}}>
            <span style={{fontSize:'var(--text-base)'}}>{n}</span>
            <span style={{fontFamily:'var(--font-mono)',fontSize:'var(--text-xs)',color:'var(--text-secondary)'}}>{ph}</span>
            <StatusChip status={s}/>
          </div>)}
        <p style={{margin:'14px 0 0',fontSize:'var(--text-sm)',color:'var(--text-secondary)'}}>2 of 5 projects are at risk. Both trace to open action items on Today.</p>
      </Card>}
      {sel==='followup'&&<Card icon={chart} title="Follow-up completion" action={<span style={{fontFamily:'var(--font-mono)',fontSize:'var(--text-xs)',color:'var(--text-secondary)'}}>last 4 weeks</span>}>
        {[['Week of Aug 25','8 of 10','80%'],['Week of Aug 18','11 of 12','92%'],['Week of Aug 11','9 of 9','100%'],['Week of Aug 4','7 of 9','78%']].map(([w,f,p])=>
          <div key={w} style={{display:'grid',gridTemplateColumns:'1fr 100px 60px',gap:12,alignItems:'center',padding:'11px 0',borderBottom:'1px solid var(--border-thin)'}}>
            <span style={{fontSize:'var(--text-base)',color:'var(--text-secondary)'}}>{w}</span>
            <span style={{fontFamily:'var(--font-mono)',fontSize:'var(--text-sm)'}}>{f}</span>
            <span style={{fontFamily:'var(--font-mono)',fontSize:'var(--text-sm)',textAlign:'right',color:p==='100%'?'var(--green)':'var(--ink)'}}>{p}</span>
          </div>)}
        <p style={{margin:'14px 0 0',fontSize:'var(--text-sm)',color:'var(--text-secondary)'}}>Completed on or before the deadline, out of all items due that week.</p>
      </Card>}
      {sel==='hours'&&<Card icon={chart} title="Partner hours saved" action={<span style={{fontFamily:'var(--font-mono)',fontSize:'var(--text-xs)',color:'var(--text-secondary)'}}>last 3 months</span>}>
        {[['August','14.5 h'],['July','12.0 h'],['June','9.5 h']].map(([m,h])=>
          <div key={m} style={{display:'grid',gridTemplateColumns:'1fr 80px',gap:12,alignItems:'center',padding:'11px 0',borderBottom:'1px solid var(--border-thin)'}}>
            <span style={{fontSize:'var(--text-base)',color:'var(--text-secondary)'}}>{m}</span>
            <span style={{fontFamily:'var(--font-mono)',fontSize:'var(--text-sm)',textAlign:'right'}}>{h}</span>
          </div>)}
        <p style={{margin:'14px 0 0',fontSize:'var(--text-sm)',color:'var(--text-secondary)'}}>Estimated from meeting capture, extraction, and invoicing automation.</p>
      </Card>}
    </div>
  </div>;
}
function ReportRow({r,active,onClick}){
  const [hover,setHover]=React.useState(false);
  return <div onClick={onClick} onMouseEnter={()=>setHover(true)} onMouseLeave={()=>setHover(false)}
    style={{padding:'11px 12px',borderRadius:'var(--radius-sm)',cursor:'pointer',background:active?'var(--navy-50)':hover?'var(--surface-hover)':'transparent',transition:'background-color var(--transition-fast)'}}>
    <div style={{fontSize:'var(--text-base)',fontWeight:active?500:400}}>{r.title}</div>
    <div style={{fontSize:'var(--text-sm)',color:'var(--text-secondary)',marginTop:2}}>{r.desc}</div>
  </div>;
}
