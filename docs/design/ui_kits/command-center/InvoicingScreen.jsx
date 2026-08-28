import React from 'react';
const DS=()=>window.CommandCenterDesignSystem_a34f56;
const BUCKETS=[["0 to 30","$18,650"],["31 to 60","$4,100"],["61 to 90","$8,200"],["90 plus","$0"]];
const ROWS=[
 {client:'Meridian Health',period:'Aug 2026',hours:'22.5 / 22.5',invoiced:'$12,400',paid:'$0',out:'$12,400',bucket:'0 to 30',hot:false},
 {client:'Halcyon Labs',period:'Aug 2026',hours:'31.0 / 31.0',invoiced:'$9,300',paid:'$3,050',out:'$6,250',bucket:'0 to 30',hot:false},
 {client:'Northgate Partners',period:'Jun 2026',hours:'18.0 / 18.0',invoiced:'$8,200',paid:'$0',out:'$8,200',bucket:'61 to 90',hot:true},
 {client:'Beacon and Cole',period:'Jul 2026',hours:'12.5 / 14.0',invoiced:'$4,100',paid:'$0',out:'$4,100',bucket:'31 to 60',hot:false},
 {client:'Halcyon Labs',period:'Jul 2026',hours:'28.0 / 28.0',invoiced:'$8,400',paid:'$8,400',out:'$0',bucket:'paid',hot:false},
];
export function InvoicingScreen(){
  const {DataTable,StatusChip,Button}=DS();
  return <div>
    <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',marginBottom:20}}>
      <div>
        <h1 style={{margin:0,fontSize:'var(--text-2xl)',fontWeight:700}}>Invoicing</h1>
        <p style={{margin:'4px 0 0',fontSize:'var(--text-base)',color:'var(--text-secondary)'}}>Hours to invoiced to paid, with aging you can see.</p>
      </div>
      <Button variant="secondary">Export PDF</Button>
    </div>
    <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:12,marginBottom:20}}>
      {BUCKETS.map(([label,amt],i)=>{
        const hot=i>=2&&amt!=='$0';
        return <div key={label} style={{background:hot?'var(--gold-50)':'var(--surface-card)',border:hot?'1px solid var(--gold)':'1px solid var(--border-thin)',borderRadius:'var(--radius-md)',boxShadow:hot?'none':'var(--shadow-card)',padding:'14px 16px'}}>
          <div style={{fontFamily:'var(--font-mono)',fontSize:'var(--text-xs)',letterSpacing:'var(--tracking-label)',textTransform:'uppercase',color:hot?'var(--gold-600)':'var(--text-secondary)'}}>{label} days</div>
          <div style={{fontFamily:'var(--font-mono)',fontSize:'var(--text-xl)',fontWeight:500,marginTop:6,color:hot?'var(--gold-600)':'var(--ink)'}}>{amt}</div>
        </div>;
      })}
    </div>
    <div style={{background:'var(--surface-card)',border:'1px solid var(--border-thin)',borderRadius:'var(--radius-md)',boxShadow:'var(--shadow-card)',padding:'4px 8px 8px'}}>
      <DataTable columns={[
        {header:'Client',key:'client',grow:true},
        {header:'Period',key:'period',mono:true},
        {header:'Hours reconciled',key:'hours',mono:true,align:'right'},
        {header:'Invoiced',key:'invoiced',mono:true,align:'right'},
        {header:'Paid',key:'paid',mono:true,align:'right'},
        {header:'Outstanding',render:r=><span style={{fontFamily:'var(--font-mono)',color:r.hot?'var(--gold-600)':'inherit',fontWeight:r.hot?500:400}}>{r.out}</span>,align:'right'},
        {header:'Aging',render:r=>r.bucket==='paid'?<StatusChip status="done" label="paid"/>:<StatusChip status={r.hot?'overdue':'open'} label={r.bucket}/>},
      ]} rows={ROWS} onRowClick={()=>{}}/>
    </div>
    <p style={{margin:'12px 4px 0',fontSize:'var(--text-sm)',color:'var(--text-secondary)'}}>Each invoice traces back to its billing period and time entries. Open a row to see them.</p>
  </div>;
}
