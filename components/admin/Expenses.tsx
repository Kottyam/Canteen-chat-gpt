import React,{useEffect,useMemo,useState}from'react';
import{supabase,supabaseEnabled}from'../../supabase';
import AsyncActionButton from'../common/AsyncActionButton';
import{useBillingSettings}from'../../hooks/useBillingSettings';
import{useAuth}from'../../context/AuthContext';
import{buildExpensesPdfModel,expensesPdfAdapter}from'../../utils/expensesPdf';

interface Expense{id:string;expense_date:string;amount:number;description:string;added_by?:string;created_by?:string;category?:string}
interface ExpenseMonth{key:string;year:number;month:number;label:string;items:Expense[];total:number}

const MONTH_NAMES=['January','February','March','April','May','June','July','August','September','October','November','December'];

const Expenses:React.FC=()=>{
  const{pooling}=useBillingSettings();
  const{user}=useAuth();
  const now=new Date();
  const[date,setDate]=useState('');
  const[items,setItems]=useState<Expense[]>([]);
  const[amount,setAmount]=useState('');
  const[description,setDescription]=useState('');
  const[editing,setEditing]=useState<string|null>(null);
  const[busy,setBusy]=useState<string|null>(null);
  const[selectedMonth,setSelectedMonth]=useState<string|null>(null);
  const[pdfYear,setPdfYear]=useState(now.getFullYear());
  const[pdfMonth,setPdfMonth]=useState(now.getMonth()+1);
  const[pdfMessage,setPdfMessage]=useState('');
  const load=async()=>{
    if(!supabaseEnabled||!supabase)return;
    const{data,error}=await supabase.from('expenses').select('id,expense_date,amount,description').order('expense_date',{ascending:false});
    if(!error)setItems((data||[]).map((x:any)=>({...x,amount:Number(x.amount)})));
  };
  useEffect(()=>{void load()},[]);
  useEffect(()=>{
    if(!supabase)return;
    const refresh=()=>void load();
    const channel=supabase.channel('gocanteen-expense-sync-v3').on('postgres_changes',{event:'*',schema:'public',table:'expenses'},refresh).subscribe();
    const interval=window.setInterval(refresh,10000);
    window.addEventListener('focus',refresh);
    return()=>{window.clearInterval(interval);window.removeEventListener('focus',refresh);void channel.unsubscribe()};
  },[]);
  const months=useMemo<ExpenseMonth[]>(()=>{
    const grouped=new Map<string,Expense[]>();
    items.forEach(x=>{
      const d=new Date(`${x.expense_date}T00:00:00`);
      if(Number.isNaN(d.getTime()))return;
      const key=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
      const list=grouped.get(key)||[];
      list.push(x);
      grouped.set(key,list);
    });
    return Array.from(grouped.entries()).sort((a,b)=>b[0].localeCompare(a[0])).map(([key,list])=>{
      const[y,m]=key.split('-').map(Number);
      return{key,year:y,month:m,label:new Date(y,m-1,1).toLocaleString('en-IN',{month:'long',year:'numeric'}),items:list,total:list.reduce((s,x)=>s+x.amount,0)};
    });
  },[items]);
  const pdfYears=useMemo(()=>{
    const ys=new Set<number>([now.getFullYear(),now.getFullYear()-1]);
    months.forEach(m=>ys.add(m.year));
    return Array.from(ys).sort((a,b)=>b-a);
  },[months]);
  const selected=selectedMonth?months.find(x=>x.key===selectedMonth)||null:null;
  const downloadPdf=()=>{
    const model=buildExpensesPdfModel(user?.canteenName||'Go Canteen',pdfYear,pdfMonth,items);
    setPdfMessage(model.empty?'No expenses for this month.':'');
    void expensesPdfAdapter.download(model);
  };
  const pdfControls=pooling?(
    <div data-testid="expense-pdf-download" className="mt-4 rounded-lg border p-4">
      <h4 className="font-semibold text-gray-800">Download PDF</h4>
      <p className="mt-1 text-sm text-gray-600">Choose a year and month to download that month’s expenses.</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <label className="text-sm font-medium">Year
          <select aria-label="Expense PDF year" value={pdfYear} onChange={e=>setPdfYear(Number(e.target.value))} className="mt-1 block w-full rounded-lg border p-2.5">
            {pdfYears.map(y=><option key={y} value={y}>{y}</option>)}
          </select>
        </label>
        <label className="text-sm font-medium">Month
          <select aria-label="Expense PDF month" value={pdfMonth} onChange={e=>setPdfMonth(Number(e.target.value))} className="mt-1 block w-full rounded-lg border p-2.5">
            {MONTH_NAMES.map((name,i)=><option key={name} value={i+1}>{name}</option>)}
          </select>
        </label>
        <div className="flex items-end">
          <button type="button" onClick={downloadPdf} className="w-full rounded-lg bg-primary-600 px-4 py-2.5 font-medium text-white shadow-sm">Download PDF</button>
        </div>
      </div>
      {pdfMessage&&<p data-testid="expense-pdf-empty" className="mt-2 text-sm text-gray-600">{pdfMessage}</p>}
    </div>
  ):null;
  const save=async()=>{
    if(busy||!supabaseEnabled||!supabase||!date||!amount)return;
    const payload={expense_date:date,amount:Number(amount),description:description.trim()};
    setBusy('save');
    try{
      const result=editing?await supabase.from('expenses').update(payload).eq('id',editing):await supabase.from('expenses').insert(payload);
      if(result.error)throw result.error;
      setAmount('');setDescription('');setEditing(null);
      await load();
      window.dispatchEvent(new Event('gocanteen:pooling-inputs-changed'));
    }catch(e){console.warn(e)}finally{setBusy(null)};
  };
  const remove=async(id:string)=>{
    if(busy||!supabase||!confirm('Delete this expense?'))return;
    setBusy(`delete:${id}`);
    try{
      const{error}=await supabase.from('expenses').delete().eq('id',id);
      if(error)throw error;
      await load();
      window.dispatchEvent(new Event('gocanteen:pooling-inputs-changed'));
    }catch(e){console.warn(e)}finally{setBusy(null)};
  };
  if(selected)return <div className="min-w-0"><button type="button" onClick={()=>setSelectedMonth(null)} className="mb-4 rounded-lg border px-3 py-2 text-sm font-medium">← Monthly Expense History</button>{pdfControls}<div className="rounded-lg border p-4"><h3 className="text-xl font-bold text-primary-900">{selected.label}</h3><p className="mt-1 text-sm text-gray-600">Expense Details</p><div className="mt-4 space-y-2">{selected.items.map(x=><div key={x.id} className="grid min-w-0 gap-1 rounded-lg border p-3 sm:grid-cols-[130px_minmax(0,1fr)_130px] sm:items-center"><div className="text-sm text-gray-600">{new Date(`${x.expense_date}T00:00:00`).toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'})}</div><div className="break-words font-medium">{x.description||'—'}</div><div className="font-semibold sm:text-right">₹{x.amount.toFixed(2)}</div><div className="flex gap-2 sm:col-span-3"><button disabled={Boolean(busy)} onClick={()=>{setEditing(x.id);setAmount(String(x.amount));setDescription(x.description);setDate(x.expense_date);setSelectedMonth(null)}} className="rounded border px-3 py-1.5 text-sm">Edit</button><AsyncActionButton loading={busy===`delete:${x.id}`} loadingLabel="Deleting…" disabled={Boolean(busy)&&busy!==`delete:${x.id}`} onClick={()=>void remove(x.id)} className="rounded border px-3 py-1.5 text-sm text-red-600">Delete</AsyncActionButton></div></div>)}</div><div className="mt-4 flex items-center justify-between border-t pt-4"><span className="font-semibold">Total Expenses</span><span className="text-lg font-bold">₹{selected.total.toFixed(2)}</span></div></div></div>;
  return <div className="min-w-0"><h3 className="text-2xl font-bold text-primary-900">Expenses</h3><p className="mt-1 text-sm text-gray-600">Enter expenses by date.</p>{pdfControls}<div className="mt-4 rounded-lg border p-4"><h4 className="font-semibold text-gray-800">Add Expense</h4><div className="mt-3 grid gap-3 sm:grid-cols-3"><label className="text-sm font-medium">Expense Date<input disabled={Boolean(busy)} type="date" value={date} onChange={e=>setDate(e.target.value||'')} className="mt-1 block w-full rounded-lg border p-2.5"/></label><input disabled={Boolean(busy)} type="number" min="0" step="0.01" placeholder="Amount" value={amount} onChange={e=>setAmount(e.target.value)} className="rounded-lg border p-2.5"/><input disabled={Boolean(busy)} placeholder="Description" value={description} onChange={e=>setDescription(e.target.value)} className="rounded-lg border p-2.5"/></div><AsyncActionButton type="button" loading={busy==='save'} loadingLabel={editing?'Updating…':'Adding…'} disabled={Boolean(busy)||!date||!amount} onClick={()=>void save()} className="mt-3 rounded-lg bg-primary-600 px-4 py-2.5 font-medium text-white shadow-sm">{editing?'Update':'Add'} Expense</AsyncActionButton>{editing&&<button type="button" onClick={()=>{setEditing(null);setAmount('');setDescription('');setDate('')}} className="ml-2 rounded-lg border px-4 py-2.5 text-sm">Cancel</button>}</div><div className="mt-6"><h4 className="text-xl font-bold text-primary-900">Monthly Expense History</h4>{months.length===0?<div className="mt-3 rounded-lg border p-4 text-sm text-gray-600">No expense history available.</div>:<div className="mt-3 space-y-2">{months.map(m=><button type="button" key={m.key} onClick={()=>setSelectedMonth(m.key)} className="block w-full rounded-lg border p-4 text-left transition hover:border-primary-300"><div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"><div><div className="font-semibold text-gray-800">{m.label}</div><div className="text-sm text-gray-600">{m.items.length} expense {m.items.length===1?'entry':'entries'}</div></div><div className="font-bold text-gray-800">₹{m.total.toFixed(2)}</div></div></button>)}</div>}</div></div>;
};
export default Expenses;
