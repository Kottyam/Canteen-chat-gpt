import React,{useEffect,useMemo,useState}from'react';
import{useData}from'../../context/DataContext';
import{clearAdminEmployeeFoodContributionOverride,loadAdminEmployeeFoodContributionSettings,AdminEmployeeFoodContributionSetting,EmployeeFoodContributionMode,saveAdminEmployeeFoodContributionSetting}from'../../services/employeeFoodContribution';
import{supabase}from'../../supabase';
import AsyncActionButton from'../common/AsyncActionButton';

const EMPTY_SETTING={contributionMode:'percentage' as EmployeeFoodContributionMode,employeeContributionPercentage:100,fixedMonthlyAmount:0};
const EmployeeFoodArrangementSettings:React.FC=()=>{
 const{users}=useData();
 const employees=useMemo(()=>users.filter(u=>u.role==='employee'&&u.status!=='deleted'&&u.identityId),[users]);
 const[settings,setSettings]=useState<AdminEmployeeFoodContributionSetting[]>([]);
 const[selectedId,setSelectedId]=useState('all');
 const[selectedIds,setSelectedIds]=useState<string[]>([]);
 const[mode,setMode]=useState<EmployeeFoodContributionMode>('percentage');
 const[percentage,setPercentage]=useState('100');
 const[fixedAmount,setFixedAmount]=useState('0');
 const[loading,setLoading]=useState(true);const[saving,setSaving]=useState(false);const[editing,setEditing]=useState(false);const[locked,setLocked]=useState(false);const[msg,setMsg]=useState('');const[msgKind,setMsgKind]=useState<'success'|'error'|'info'>('info');
 const globalSetting=settings.find(s=>s.scope==='all');
 const individualSetting=selectedId==='all'?undefined:settings.find(s=>s.scope==='employee'&&s.employeeId===selectedId);
 const selectedEmployee=employees.find(e=>(e.identityId||'')===selectedId);
 const individualIds=useMemo(()=>new Set(settings.filter(s=>s.scope==='employee').map(s=>s.employeeId).filter(Boolean)),[settings]);
 const availableEmployees=useMemo(()=>employees.filter(e=>e.identityId&&!individualIds.has(e.identityId)),[employees,individualIds]);
 const effective=selectedId==='all'?(globalSetting||EMPTY_SETTING):(individualSetting||globalSetting||EMPTY_SETTING);
 const effectiveSource=selectedId==='all'?(globalSetting?'All Employees':'No configuration'):(individualSetting?'Individual override':globalSetting?'All Employees default':'No configuration');
 const commonLabel=individualIds.size>0?`All Other Employees (${availableEmployees.length} remaining)`:'All Employees';
 const setMessage=(text:string,kind:'success'|'error'|'info'='info')=>{setMsg(text);setMsgKind(kind)};
 const applyDraft=(id:string,currentSettings=settings)=>{
   const global=currentSettings.find(s=>s.scope==='all');
   const individual=id==='all'?undefined:currentSettings.find(s=>s.scope==='employee'&&s.employeeId===id);
   const value=id==='all'?(global||EMPTY_SETTING):(individual||global||EMPTY_SETTING);
   setMode(value.contributionMode);setPercentage(String(value.employeeContributionPercentage));setFixedAmount(String(value.fixedMonthlyAmount));
 };
 const load=async()=>{setLoading(true);try{const[rows,lockResult]=await Promise.all([loadAdminEmployeeFoodContributionSettings(),supabase?.rpc('employee_food_contribution_setting_locked')]);const normalized=rows||[];setSettings(normalized);setLocked(!lockResult?.error&&Boolean(lockResult?.data));applyDraft(selectedId,normalized);setMessage('','info')}catch(e:any){setMessage(e?.message||'Could not load employee food arrangement settings.','error')}finally{setLoading(false)}};
 useEffect(()=>{void load()},[]);
 const numericPercentage=Number(percentage);const numericFixed=Number(fixedAmount);const validPercentage=Number.isFinite(numericPercentage)&&numericPercentage>=0&&numericPercentage<=100;const validFixed=Number.isFinite(numericFixed)&&numericFixed>=0;const valid=mode==='percentage'?validPercentage:validFixed;
 const selectEmployee=(id:string)=>{if(saving)return;setSelectedId(id);setSelectedIds([]);applyDraft(id);setEditing(id==='all');setMessage('','info')};
 const toggleEmployee=(id:string)=>{if(saving||locked)return;setSelectedIds(current=>current.includes(id)?current.filter(x=>x!==id):[...current,id]);setSelectedId('');setEditing(true);setMessage('','info')};
 const selectAllRemaining=()=>{if(saving||locked)return;setSelectedIds(current=>current.length===availableEmployees.length?[]:availableEmployees.map(e=>e.identityId!));setSelectedId('');setEditing(true);setMessage('','info')};
 const startEdit=()=>{applyDraft(selectedId||'all');setEditing(true);setMessage('','info')};
 const cancel=()=>{applyDraft(selectedId||'all');setSelectedIds([]);setSelectedId(selectedId||'all');setEditing(false);setMessage('Unsaved changes were discarded.','info')};
 const save=async()=>{
   if(saving||locked||!valid)return;
   const ids=selectedIds.filter(id=>availableEmployees.some(e=>e.identityId===id));
   if(selectedId!==''&&selectedId!=='all'&&individualSetting)ids.push(selectedId);
   const uniqueIds=[...new Set(ids)];
   if(selectedId===''&&!uniqueIds.length){setMessage('Select at least one remaining employee.','error');return}
   setSaving(true);setMessage('','info');
   try{
     if(uniqueIds.length){await Promise.all(uniqueIds.map(id=>saveAdminEmployeeFoodContributionSetting(id,mode,numericPercentage,numericFixed)))}else{await saveAdminEmployeeFoodContributionSetting(null,mode,numericPercentage,numericFixed)}
     const rows=await loadAdminEmployeeFoodContributionSettings();setSettings(rows);setSelectedIds([]);applyDraft(selectedId||'all',rows);setEditing(false);setMessage(selectedId==='all'?'All Employees food arrangement saved successfully.':uniqueIds.length>1?`${uniqueIds.length} individual overrides added successfully.`:individualSetting?'Individual employee override updated successfully.':'Individual employee override added successfully.','success');
   }catch(e:any){setMessage(e?.message||'Could not save employee food arrangement.','error')}
   finally{setSaving(false)}
 };
 const removeOverride=async(employeeId:string)=>{
   if(saving||locked)return;
   setSaving(true);setMessage('','info');
   try{
     await clearAdminEmployeeFoodContributionOverride(employeeId);
     const rows=await loadAdminEmployeeFoodContributionSettings();setSettings(rows);
     if(selectedId===employeeId){applyDraft('all',rows);setSelectedId('all');setEditing(true)}
     setMessage('Individual override removed. The employee now inherits the All Employees setting.','success');
   }catch(e:any){setMessage(e?.message||'Could not remove employee food arrangement override.','error')}
   finally{setSaving(false)}
 };
 const contributionSummary=mode==='percentage'?{member:validPercentage?numericPercentage:100,company:validPercentage?100-numericPercentage:0}:{member:null,company:null};
 const individualOverrides=settings.filter(s=>s.scope==='employee');
 return <section className="rounded-xl border bg-white p-4"><div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between"><div><h4 className="font-bold">Employee Food Arrangement</h4><p className="mt-1 text-sm text-gray-500">Configure the common default, then add independent employee overrides. If no arrangement is configured, the member pays 100%. Fixed Amount is a monthly company-covered allowance, not an order limit.</p></div>{!editing&&<button type="button" disabled={loading||saving||locked} onClick={startEdit} className="min-h-11 rounded-lg border px-5 font-semibold text-gray-700">Edit</button>}</div>
 <div className="mt-4 max-w-2xl space-y-4">
  <div><div className="text-sm font-semibold text-gray-700">Common Arrangement</div><button type="button" disabled={loading||saving} onClick={()=>selectEmployee('all')} className={`mt-1 w-full rounded-lg border px-3 py-2.5 text-left ${selectedId==='all'?'border-primary-600 bg-primary-50':''}`}>{commonLabel}<span className="mt-1 block text-xs text-gray-500">{individualIds.size>0?'Applies only to active employees without an individual override.':'Default for all active employees unless an individual override is added.'}</span></button></div>
  <div><div className="text-sm font-semibold text-gray-700">Add Individual Employees</div><div className="mt-1 rounded-lg border bg-gray-50 p-2">{availableEmployees.length===0?<p className="p-2 text-sm text-gray-500">All active employees already have individual overrides.</p>:<><label className="flex min-h-11 items-center gap-2 rounded-md px-2 py-2 text-sm font-semibold"><input type="checkbox" disabled={loading||saving||locked} checked={availableEmployees.length>0&&selectedIds.length===availableEmployees.length} onChange={selectAllRemaining} className="h-5 w-5"/>Select All Remaining</label><div className="max-h-56 overflow-y-auto">{availableEmployees.map(e=>{const id=e.identityId!;return <label key={id} className="flex min-h-11 items-center gap-2 rounded-md px-2 py-2 text-sm hover:bg-white"><input type="checkbox" disabled={loading||saving||locked} checked={selectedIds.includes(id)} onChange={()=>toggleEmployee(id)} className="h-5 w-5"/><span>{e.name}</span></label>})}</div></>}</div><span className="mt-1 block text-xs text-gray-500">Only active employees without an individual override are shown. Select one or more employees and apply the same arrangement to all selected employees.</span></div>
  {selectedId!==''&&selectedId!=='all'&&<div className="rounded-lg border border-blue-100 bg-blue-50 p-3 text-sm text-blue-800">{individualSetting?`Editing ${selectedEmployee?.name||'employee'}'s saved individual override.`:`This member has no individual override. The common setting is used when one exists; otherwise the member pays 100%.`}</div>}
  <div><div className="text-sm font-semibold text-gray-700">Contribution Mode</div><div className="mt-2 grid grid-cols-2 gap-2"><button type="button" disabled={loading||saving||locked||!editing} onClick={()=>{setMode('percentage');setMessage('','info')}} className={`min-h-11 rounded-lg border px-3 py-2 text-sm font-semibold ${mode==='percentage'?'border-primary-600 bg-primary-50 text-primary-700':'text-gray-600'}`}>Percentage</button><button type="button" disabled={loading||saving||locked||!editing} onClick={()=>{setMode('fixed_amount');setMessage('','info')}} className={`min-h-11 rounded-lg border px-3 py-2 text-sm font-semibold ${mode==='fixed_amount'?'border-primary-600 bg-primary-50 text-primary-700':'text-gray-600'}`}>Fixed Amount</button></div></div>
  {mode==='percentage'?<label className="block text-sm font-semibold text-gray-700">Member Contribution<input disabled={loading||saving||locked||!editing} type="number" min="0" max="100" step="1" inputMode="numeric" value={percentage} onChange={e=>{setPercentage(e.target.value);setMessage('','info')}} className="mt-1 block w-full rounded-lg border px-3 py-2.5 disabled:bg-gray-50"/><span className="mt-1 block text-xs text-gray-500">Range: 0–100%. 100% means Member pays the full eligible gross amount and Company Contribution is 0%. 0% means Company pays 100% and Member pays 0%.</span></label>:<label className="block text-sm font-semibold text-gray-700">Monthly Company-Covered Allowance<input disabled={loading||saving||locked||!editing} type="number" min="0" step="0.01" inputMode="decimal" value={fixedAmount} onChange={e=>{setFixedAmount(e.target.value);setMessage('','info')}} className="mt-1 block w-full rounded-lg border px-3 py-2.5 disabled:bg-gray-50"/><span className="mt-1 block text-xs text-gray-500">₹{Number.isFinite(numericFixed)?numericFixed.toFixed(2):'0.00'} per calendar month. This does not limit order size. Once the allowance is used, the member pays the remaining eligible food amount.</span></label>}
  {mode==='percentage'&&validPercentage&&<div className="rounded-lg bg-primary-50 p-3 text-sm"><div className="flex justify-between font-semibold text-primary-800"><span>Member Contribution</span><span>{contributionSummary.member}%</span></div><div className="mt-1 flex justify-between font-semibold text-primary-800"><span>Company Contribution</span><span>{contributionSummary.company}%</span></div></div>}
  {mode==='percentage'&&!validPercentage&&editing&&<p className="text-sm text-red-600">Enter a percentage from 0% to 100%.</p>}{mode==='fixed_amount'&&!validFixed&&editing&&<p className="text-sm text-red-600">Enter a monthly allowance of ₹0 or more.</p>}
  {locked&&<p className="rounded-lg bg-amber-50 p-3 text-sm font-semibold text-amber-800">Locked — Order Time is currently open. The current employee food arrangement cannot be changed during the active order cycle.</p>}
  {!loading&&<div className="rounded-lg border bg-gray-50 p-3 text-sm"><div className="font-semibold">{selectedId==='all'||selectedId===''?commonLabel:`Current setting for ${selectedEmployee?.name||'member'}`}</div><div className="mt-1">{effective.contributionMode==='fixed_amount'?`Fixed Amount — ₹${Number(effective.fixedMonthlyAmount||0).toFixed(2)} / month`:`Percentage — Member Contribution ${Number(effective.employeeContributionPercentage)}% / Company Contribution ${100-Number(effective.employeeContributionPercentage)}%`}</div><div className="mt-1 text-xs text-gray-500">Source: {effectiveSource}. {effectiveSource==='No configuration'?'Default: Member Contribution 100% / Company Contribution 0%.':''}</div></div>}
  {editing&&<div className="flex flex-col gap-2 sm:flex-row"><AsyncActionButton type="button" loading={saving} loadingLabel="Saving…" disabled={loading||saving||locked||!valid||(selectedId===''&&!selectedIds.length)} onClick={()=>void save()} className="min-h-11 rounded-lg bg-primary-600 px-5 font-semibold text-white">{selectedId==='all'?'Save Default':individualSetting?'Update Override':'Add Override'}</AsyncActionButton><button type="button" disabled={saving} onClick={cancel} className="min-h-11 rounded-lg border px-5 font-semibold text-gray-700">Cancel</button></div>}
  {individualOverrides.length>0&&<div className="rounded-lg border p-3"><div className="font-semibold text-gray-700">Saved Individual Overrides</div><div className="mt-2 space-y-2">{individualOverrides.map(s=><div key={s.employeeId} className="flex flex-col gap-2 rounded-lg border bg-gray-50 p-3 sm:flex-row sm:items-center sm:justify-between"><button type="button" disabled={saving||locked} onClick={()=>selectEmployee(s.employeeId)} className="text-left"><div className="font-semibold text-gray-800">{s.employeeName||'Employee'}</div><div className="text-sm text-gray-600">{s.contributionMode==='fixed_amount'?`Fixed Amount — ₹${Number(s.fixedMonthlyAmount||0).toFixed(2)} / month`:`Percentage — ${Number(s.employeeContributionPercentage)}% Member / ${100-Number(s.employeeContributionPercentage)}% Company`}</div></button><button type="button" disabled={saving||locked} onClick={()=>void removeOverride(s.employeeId)} className="min-h-10 rounded-lg border px-4 text-sm font-semibold text-red-700">Remove</button></div>)}</div></div>}
  {msg&&<p role={msgKind==='error'?'alert':'status'} className={`rounded-lg p-3 text-sm ${msgKind==='success'?'bg-green-50 text-green-800':msgKind==='error'?'bg-red-50 text-red-700':'bg-gray-50 text-gray-700'}`}>{msg}</p>}
 </div></section>;
};export default EmployeeFoodArrangementSettings;
