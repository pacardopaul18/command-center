import React from 'react';
const DS=()=>window.CommandCenterDesignSystem_a34f56;
export function LoginScreen({onSignIn}){
  const {Card,Button,Input,FormField}=DS();
  const [pin,setPin]=React.useState('');
  const set=v=>{const p=v.replace(/\D/g,'');setPin(p);if(p.length===6)setTimeout(()=>onSignIn&&onSignIn(),250);};
  return <div style={{minHeight:'100vh',display:'flex',alignItems:'center',justifyContent:'center',background:'var(--surface-page)'}}>
    <div style={{width:360}}>
      <div style={{textAlign:'center',marginBottom:24}}>
        <div style={{fontSize:'var(--text-lg)',fontWeight:700,color:'var(--navy)'}}>Command Center</div>
        <div style={{fontSize:'var(--text-base)',color:'var(--text-secondary)',marginTop:6}}>Enter the PIN from your email to sign in.</div>
      </div>
      <Card padding={24} style={{borderRadius:'var(--radius-lg)'}}>
        <FormField label="Email PIN">
          <Input mono placeholder="000000" value={pin} maxLength={6} onChange={e=>set(e.target.value)} style={{textAlign:'center',letterSpacing:'.4em',fontSize:'var(--text-lg)'}} onKeyDown={e=>{if(e.key==='Enter'&&pin.length===6)onSignIn&&onSignIn();}}/>
        </FormField>
        <Button style={{width:'100%',justifyContent:'center',marginTop:16}} disabled={pin.length!==6} onClick={onSignIn}>Sign in</Button>
      </Card>
      <div style={{textAlign:'center',marginTop:16,fontFamily:'var(--font-mono)',fontSize:'var(--text-xs)',color:'var(--text-secondary)'}}>The PIN expires after 10 minutes. Demo: any 6 digits.</div>
    </div>
  </div>;
}
