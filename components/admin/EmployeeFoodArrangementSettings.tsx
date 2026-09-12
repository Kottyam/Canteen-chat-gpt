import React,{useEffect,useMemo,useState}from'react';
import{useData}from'../../context/DataContext';
import{clearAdminEmployeeFoodContributionOverride,loadAdminEmployeeFoodContributionSettings,AdminEmployeeFoodContributionSetting,EmployeeFoodContributionMode,saveAdminEmployeeFoodContributionSetting}from'../../services/employeeFoodContribution';
import{supabase}from'../../supabase';
import AsyncActionButton from'../common/AsyncActionButton';

const EMPTY_SETTING={contributionMode:'percentage' as EmployeeFoodContributionMode,employeeContributionPercentage:0,fixedMonthlyAmount:0};
const EmployeeFoodArrangementSettings:React.FC=()=>{
 const{users}=useData();
 const employees=useMemo(()=>users.filter(u=>u.role==='employee'&&u.status!=='deleted'),[users]);
 const[settings,setSettings]=useState<AdminEmployeeFoodContributionSetting[]>([]);
 const[selectedId,setSelectedId]=useState('all');
 const[mode,setMode]=useState<EmployeeFoodContributionMode>('percentage');
 const[percentage,setPercentage]=useState('0');
 const[fixedAmount,setFixedAmount]=useState('0');
 const[useOverride,setUseOverride]=useState(false);
 const[loading,setLoading]=useState(true);const[saving,setSaving]=useState(false);const[editing,setEditing]=useState(false);const[locked,setLocked]=useState(false);const[msg,setMsg]=useState('');const[msgKind,setMsgKind]=useState<'success'|'error'|'info'>('info');
 const globalSetting=settings.find(s=>s.scope==='all');
 const individualSetting=selectedId==='all'?undefined:settings.find(s=>s.scope==='employee'&&s.employeeId===selectedId);
 const selectedEmployee=employees.find(e=>e.id===selectedId);
 const effective=selectedId==='all'?(globalSetting||EMPTY_SETTING):(individualSetting||globalSetting||EMPTY_SETTING);
 const effectiveSource=selectedId==='all'?(globalSetting?'All Employees':'No configuration'):(individualSetting?'Individual override':globalSetting?'All Employees default':'No configuration');
 const setMessage=(text:string,kind:'success'|'error'|'info'='info')=>{setMsg(text);setMsgKind(kind)};
 const applyDraft=(id:string,currentSettings= settings)=>{
   const global=currentSettings.find(s=>s.scope==='all');
   const individual=id==='all'?undefined:currentSettings.find(s=>s.scope==='employee'&&s.employeeId===id);
   const value=id==='all'?(global||EMPTY_SETTING):(individual||global||EMPTY_SETTING);
   setMode(value.contributionMode);setPercentage(String(value.employeeContributionPercentage));setFixedAmount(String(value.fixedMonthlyAmount));setUseOverride(id!=='all'&&Boolean(individual));
 };
 const load=async()=>{setLoading(true);try{const[rows,lockResult]=await Promise.all([loadAdminEmployeeFoodContributionSettings(),supabase?.rpc('employee_food_contribution_setting_locked')]);const normalized=rows||[];setSettings(normalized);setLocked(!lockResult?.error&&Boolean(lockResult?.data));applyDraft(selectedId,normalized);setMessage('','info')}catch(e:any){setMessage(e?.message||'Could not load employee food arrangement settings.','error')}finally{setLoading(false)}};
 useEffect(()=>{void load()},[]);
 const numericPercentage=Number(percentage);const numericFixed=Number(fixedAmount);const validPercentage=Number.isFinite(numericPercentage)&&numericPercentage>=0&&numericPercentage<=100;const validFixed=Number.isFinite(numericFixed)&&numericFixed>=0;const valid=selectedId!=='all'&&!useOverride?true:(mode==='percentage'?validPercentage:validFixed);
 const selectEmployee=(id:string)=>{if(saving)return;setSelectedId(id);applyDraft(id);setEditing(false);setMessage('','info')};
 const startEdit=()=>{applyDraft(selectedId);setEditing(true);setMessage('','info')};
 const cancel=()=>{applyDraft(selectedId);setEditing(false);setMessage('Unsaved changes were discarded.','info')};
 const save=async()=>{
   if(saving||locked||!valid)return;
   setSaving(true);setMessage('','info');
   try{
     if(selectedId!=='all'&&!useOverride){await clearAdminEmployeeFoodContributionOverride(selectedId)}
     else{await saveAdminEmployeeFoodContributionSetting(selectedId==='all'?null:selectedId,mode,numericPercentage,numericFixed)}
     const rows=await loadAdminEmployeeFoodContributionSettings();setSettings(rows);applyDraft(selectedId,rows);setEditing(false);setMessage(selectedId==='all'?'All Employees food arrangement saved successfully.':'Employee food arrangement saved successfully.','success');
   }catch(e:any){setMessage(e?.message||'Could not save employee food arrangement.','error')}
   finally{setSaving(false)}
 };
 const contributionSummary=mode==='percentage'?{member:100-(validPercentage?numericPercentage:0),company:validPercentage?numericPercentage:0}:{member:null,company:null};
 return <section className="rounded-xl border bg-white p-4"><div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between"><div><h4 className="font-bold">Employee Food Arrangement</h4><p className="mt-1 text-sm text-gray-500">Configure the All Employees default or an individual member override. Fixed Amount is a monthly company-covered allowance, not an order limit.</p></div>{!editing&&<button type="button" disabled={loading||saving||locked||selectedId===''} onClick={startEdit} className="min-h-11 rounded-lg border px-5 font-semibold text-gray-700">Edit</button>}</div>
 <div className="mt-4 max-w-2xl space-y-4">
  <label className="block text-sm font-semibold text-gray-700">Employee<select disabled={loading||saving} value={selectedId} onChange={e=>selectEmployee(e.target.value)} className="mt-1 block w-full rounded-lg border px-3 py-2.5 disabled:bg-gray-50"><option value="all">All Employees</option>{employees.map(e=><option key={e.id} value={e.id}>{e.name}{e.id?` — ${e.id}`:''}</option>)}</select></label>
  {selectedId!=='all'&&editing&&<label className="flex min-h-11 items-center gap-3 rounded-lg border bg-gray-50 px-3 py-2.5 text-sm"><input type="checkbox" checked={useOverride} disabled={saving||locked} onChange={e=>{const next=e.target.checked;setUseOverride(next);if(next&&!individualSetting){setMode(globalSetting?.contributionMode||'percentage');setPercentage(String(globalSetting?.employeeContributionPercentage??0));setFixedAmount(String(globalSetting?.fixedMonthlyAmount??0))}setMessage('','info')}} className="h-5 w-5"/><span><span className="font-semibold">Use individual override</span><span className="block text-xs text-gray-500">Turn this off to inherit the All Employees arrangement.</span></span></label>}
  {selectedId!=='all'&&!editing&&!individualSetting&&<div className="rounded-lg border border-blue-100 bg-blue-50 p-3 text-sm text-blue-800">This member has no individual override. The All Employees setting is used when one exists.</div>}
  <div><div className="text-sm font-semibold text-gray-700">Contribution Mode</div><div className="mt-2 grid grid-cols-2 gap-2"><button type="button" disabled={loading||saving||locked||!editing||(selectedId!=='all'&&!useOverride)} onClick={()=>{setMode('percentage');setMessage('','info')}} className={`min-h-11 rounded-lg border px-3 py-2 text-sm font-semibold ${mode==='percentage'?'border-primary-600 bg-primary-50 text-primary-700':'text-gray-600'}`}>Percentage</button><button type="button" disabled={loading||saving||locked||!editing||(selectedId!=='all'&&!useOverride)} onClick={()=>{setMode('fixed_amount');setMessage('','info')}} className={`min-h-11 rounded-lg border px-3 py-2 text-sm font-semibold ${mode==='fixed_amount'?'border-primary-600 bg-primary-50 text-primary-700':'text-gray-600'}`}>Fixed Amount</button></div></div>
  {mode==='percentage'?<label className="block text-sm font-semibold text-gray-700">Member Contribution<input disabled={loading||saving||locked||!editing||(selectedId!=='all'&&!useOverride)} type="number" min="0" max="100" step="1" inputMode="numeric" value={percentage} onChange={e=>{setPercentage(e.target.value);setMessage('','info')}} className="mt-1 block w-full rounded-lg border px-3 py-2.5 disabled:bg-gray-50"/><span className="mt-1 block text-xs text-gray-500">Range: 0–100%. 0% means Member Contribution is 100% of the eligible gross amount and Company Contribution is 0%.</span></label>:<label className="block text-sm font-semibold text-gray-700">Monthly Company-Covered Allowance<input disabled={loading||saving||locked||!editing||(selectedId!=='all'&&!useOverride)} type="number" min="0" step="0.01" inputMode="decimal" value={fixedAmount} onChange={e=>{setFixedAmount(e.target.value);setMessage('','info')}} className="mt-1 block w-full rounded-lg border px-3 py-2.5 disabled:bg-gray-50"/><span className="mt-1 block text-xs text-gray-500">₹{Number.isFinite(numericFixed)?numericFixed.toFixed(2):'0.00'} per calendar month. This does not limit order size. Once the allowance is used, the member pays the remaining eligible food amount.</span></label>}
  {mode==='percentage'&&validPercentage&&<div className="rounded-lg bg-primary-50 p-3 text-sm"><div className="flex justify-between font-semibold text-primary-800"><span>Member Contribution</span><span>{contributionSummary.member}%</span></div><div className="mt-1 flex justify-between font-semibold text-primary-800"><span>Company Contribution</span><span>{contributionSummary.company}%</span></div></div>}
  {mode==='percentage'&&!validPercentage&&editing&&<p className="text-sm text-red-600">Enter a percentage from 0% to 100%.</p>}{mode==='fixed_amount'&&!validFixed&&editing&&<p className="text-sm text-red-600">Enter a monthly allowance of ₹0 or more.</p>}
  {locked&&<p className="rounded-lg bg-amber-50 p-3 text-sm font-semibold text-amber-800">Locked — Order Time is currently open. The current employee food arrangement cannot be changed during the active order cycle.</p>}
  {!loading&&<div className="rounded-lg border bg-gray-50 p-3 text-sm"><div className="font-semibold">{selectedId==='all'?'All Employees default':`Current setting for ${selectedEmployee?.name||'member'}`}</div><div className="mt-1">{effective.contributionMode==='fixed_amount'?`Fixed Amount — ₹${Number(effective.fixedMonthlyAmount||0).toFixed(2)} / month`:`Percentage — Member Contribution ${Number(effective.employeeContributionPercentage||0)}% / Company Contribution ${100-Number(effective.employeeContributionPercentage||0)}%`}</div><div className="mt-1 text-xs text-gray-500">Source: {effectiveSource}.</div></div>}
  {editing&&<div className="flex flex-col gap-2 sm:flex-row"><AsyncActionButton type="button" loading={saving} loadingLabel="Saving…" disabled={loading||saving||locked||!valid} onClick={()=>void save()} className="min-h-11 rounded-lg bg-primary-600 px-5 font-semibold text-white">Save</AsyncActionButton><button type="button" disabled={saving} onClick={cancel} className="min-h-11 rounded-lg border px-5 font-semibold text-gray-700">Cancel</button></div>}
  {msg&&<p role={msgKind==='error'?'alert':'status'} className={`rounded-lg p-3 text-sm ${msgKind==='success'?'bg-green-50 text-green-800':msgKind==='error'?'bg-red-50 text-red-700':'bg-gray-50 text-gray-700'}`}>{msg}</p>}
 </div></section>;
};export default EmployeeFoodArrangementSettings;
