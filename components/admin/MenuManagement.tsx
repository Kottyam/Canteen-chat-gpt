import React,{useEffect,useMemo,useState}from'react';
import{MenuItem}from'../../types';
import{getWeeklyMenu,saveWeeklyMenu}from'../../services/supabaseSync';
import{useData}from'../../context/DataContext';
import AsyncActionButton from'../common/AsyncActionButton';

const DAYS=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

interface MenuManagementProps{initialWeekday?:number}
const MenuManagement:React.FC<MenuManagementProps>=({initialWeekday})=>{
  const{menuItems}=useData();
  const[selectedDay,setSelectedDay]=useState<number|null>(null);
  const[items,setItems]=useState<MenuItem[]>([]);
  const[loading,setLoading]=useState(false);
  const[saving,setSaving]=useState(false);
  const[message,setMessage]=useState('');
  const[editingCode,setEditingCode]=useState<string|null>(null);
  const[editName,setEditName]=useState('');
  const[editPrice,setEditPrice]=useState('');
  const[newName,setNewName]=useState('');
  const[newPrice,setNewPrice]=useState('');
  const dayLabel=selectedDay==null?'':DAYS[selectedDay];

  const loadDay=async(day:number)=>{
    setSelectedDay(day);setLoading(true);setMessage('');setEditingCode(null);
    try{setItems(await getWeeklyMenu(day))}
    catch(error){console.error(error);setItems([]);setMessage('Unable to load menu. Please try again.')}
    finally{setLoading(false)}
  };

  useEffect(()=>{if(Number.isInteger(initialWeekday)&&initialWeekday>=0&&initialWeekday<=6)void loadDay(initialWeekday)},[initialWeekday]);

  const refreshDays=async()=>{
    setLoading(true);
    try{return await Promise.all(DAYS.map((_,day)=>getWeeklyMenu(day)))}
    catch(error){console.error(error);return DAYS.map(()=>[] as MenuItem[])}
    finally{setLoading(false)}
  };

  const[dayCounts,setDayCounts]=useState<number[]>(Array(7).fill(0));
  useEffect(()=>{let alive=true;void refreshDays().then(result=>{if(alive)setDayCounts(result.map(day=>day.length))});return()=>{alive=false}},[]);

  const activeItems=useMemo(()=>items.filter(i=>i.active&&!i.archived),[items]);
  const patch=(code:string,next:Partial<MenuItem>)=>setItems(prev=>prev.map(item=>item.itemCode===code?{...item,...next}:item));

  const add=()=>{
    const name=newName.trim();const priceText=newPrice.trim();
    if(!name&&!priceText){setMessage('Please enter item name and price.');return}
    if(!name){setMessage('Please enter an item name.');return}
    if(!priceText){setMessage('Please enter a price.');return}
    const price=Number(priceText);
    if(!Number.isFinite(price)||price<0){setMessage('Please enter a valid price.');return}
    const base=name.toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'')||'item';
    let code=base;let n=2;
    while(items.some(i=>i.itemCode===code)||menuItems.some(i=>i.itemCode===code)){code=base+'_'+n++}
    setItems(prev=>[...prev,{itemCode:code,itemName:name,unitPrice:price,active:true,archived:false}]);
    setNewName('');setNewPrice('');setMessage('');
  };

  const startEdit=(item:MenuItem)=>{
    setEditingCode(item.itemCode);setEditName(item.itemName);setEditPrice(String(item.unitPrice));setMessage('');
  };
  const cancelEdit=()=>{setEditingCode(null);setEditName('');setEditPrice('')};

  const saveEdit=()=>{
    if(!editingCode)return;
    const name=editName.trim();const priceText=editPrice.trim();
    if(!name&&!priceText){setMessage('Please enter item name and price.');return}
    if(!name){setMessage('Please enter an item name.');return}
    if(!priceText){setMessage('Please enter a price.');return}
    const price=Number(priceText);
    if(!Number.isFinite(price)||price<0){setMessage('Please enter a valid price.');return}
    patch(editingCode,{itemName:name,unitPrice:price});cancelEdit();setMessage('');
  };

  const remove=(code:string)=>{if(editingCode===code)cancelEdit();setItems(prev=>prev.filter(i=>i.itemCode!==code))};

  const save=async()=>{
    if(selectedDay==null||saving)return;
    if(editingCode){setMessage('Please save or cancel the current item edit first.');return}
    const clean=items.map(i=>({...i,itemName:i.itemName.trim(),unitPrice:Number(i.unitPrice),active:true,archived:false}));
    for(const item of clean){
      if(!item.itemName){setMessage('Please enter an item name.');return}
      if(!Number.isFinite(item.unitPrice)||item.unitPrice<0){setMessage('Please enter a valid price.');return}
    }
    setSaving(true);setMessage('');
    try{
      await saveWeeklyMenu(selectedDay,clean);
      const persisted=await getWeeklyMenu(selectedDay);
      setItems(persisted);
      setDayCounts(prev=>{const n=[...prev];n[selectedDay]=persisted.length;return n});
      setMessage('Weekly menu saved successfully.');
    }catch(error){console.error(error);setMessage('Unable to save menu. Please try again.')}
    finally{setSaving(false)}
  };

  if(selectedDay!=null)return <div className="w-full min-w-0">
    <button type="button" onClick={()=>{setSelectedDay(null);setMessage('')}} className="mb-4 min-h-11 rounded-lg px-2 text-sm font-semibold text-primary-700 hover:bg-primary-50">← Menu & Prices</button>
    <div className="mb-5"><h3 className="text-2xl font-bold text-gray-800">{dayLabel}</h3><p className="mt-1 text-sm text-gray-500">{activeItems.length} menu item{activeItems.length===1?'':'s'}</p></div>
    {message&&<div className="mb-4 rounded-lg bg-gray-50 p-3 text-sm text-gray-700">{message}</div>}
    {loading?<div className="rounded-xl border bg-gray-50 p-4 text-sm text-gray-600">Loading menu…</div>:<>
      <div className="mb-5"><h4 className="mb-3 text-base font-bold text-gray-800">Menu Items</h4><div className="space-y-2">
        {activeItems.map(item=>editingCode===item.itemCode?
          <div key={item.itemCode} className="rounded-xl border bg-white p-3 shadow-sm">
            <div className="space-y-2">
              <input value={editName} disabled={saving} onChange={e=>setEditName(e.target.value)} aria-label="Item name" className="min-h-11 w-full rounded-lg border px-3 text-sm outline-none focus:border-primary-500"/>
              <div className="flex"><span className="flex min-h-11 items-center rounded-l-lg border border-r-0 bg-gray-50 px-3 text-gray-500">₹</span><input type="text" inputMode="decimal" value={editPrice} disabled={saving} onChange={e=>setEditPrice(e.target.value)} aria-label="Price" className="min-h-11 w-full rounded-r-lg border px-3 text-right text-sm outline-none focus:border-primary-500"/></div>
              <div className="flex gap-2"><button type="button" disabled={saving} onClick={saveEdit} className="min-h-11 flex-1 rounded-lg bg-primary-600 px-4 font-semibold text-white">Save Edit</button><button type="button" disabled={saving} onClick={cancelEdit} className="min-h-11 flex-1 rounded-lg border px-4 font-semibold text-gray-700">Cancel</button></div>
            </div>
          </div>
        :
          <div key={item.itemCode} className="rounded-xl border bg-white p-3 shadow-sm">
            <div className="flex items-center gap-2">
              <div className="min-w-0 flex-1"><div className="break-words text-sm font-medium text-gray-800">{item.itemName}</div><div className="mt-1 text-sm font-semibold text-gray-700">₹{item.unitPrice}</div></div>
              <button type="button" disabled={saving} title="Edit" aria-label={'Edit '+item.itemName} onClick={()=>startEdit(item)} className="min-h-11 min-w-11 rounded-lg border text-primary-700 hover:bg-primary-50">✎</button>
              <button type="button" disabled={saving} title="Delete" aria-label={'Delete '+item.itemName} onClick={()=>remove(item.itemCode)} className="min-h-11 min-w-11 rounded-lg border text-red-600 hover:bg-red-50">🗑</button>
            </div>
          </div>
        )}
        {!activeItems.length&&<div className="rounded-xl border border-dashed bg-gray-50 p-5 text-center text-sm text-gray-500">No menu added yet.</div>}
      </div></div>
      <div className="rounded-xl border bg-gray-50 p-3 sm:p-4"><h4 className="mb-3 text-base font-bold text-gray-800">Add Menu Item</h4><div className="space-y-2">
        <input value={newName} disabled={saving} onChange={e=>setNewName(e.target.value)} placeholder="Item name" className="min-h-12 w-full rounded-lg border px-3 text-base"/>
        <div className="flex"><span className="flex min-h-12 items-center rounded-l-lg border border-r-0 bg-white px-4 text-gray-500">₹</span><input type="text" inputMode="decimal" value={newPrice} disabled={saving} onChange={e=>setNewPrice(e.target.value)} placeholder="Price" className="min-h-12 w-full rounded-r-lg border px-3 text-base"/></div>
        <button type="button" disabled={saving} onClick={add} className="min-h-12 w-full rounded-lg border border-primary-600 bg-white px-4 font-semibold text-primary-700">+ Add Menu Item</button>
      </div></div>
      <AsyncActionButton loading={saving} loadingLabel="Saving…" onClick={()=>void save()} className="mt-4 min-h-12 w-full rounded-lg bg-primary-600 px-4 font-semibold text-white">Save</AsyncActionButton>
    </>}
  </div>;

  return <div className="w-full min-w-0">
    <div className="mb-5"><h3 className="text-2xl font-bold text-gray-800">Menu & Prices</h3><p className="mt-1 text-sm text-gray-500">Configure the weekly menu for each day.</p></div>
    <div className="space-y-3">{DAYS.map((day,index)=><button key={day} type="button" onClick={()=>void loadDay(index)} className="flex min-h-20 w-full items-center justify-between rounded-xl border bg-white p-4 text-left shadow-sm transition hover:border-primary-300 hover:bg-primary-50">
      <span><span className="block text-base font-bold text-gray-800">{day}</span><span className="mt-1 block text-sm text-gray-500">{dayCounts[index]>0?dayCounts[index]+' menu item'+(dayCounts[index]===1?'':'s'):'No menu added'}</span></span><span className="text-xl text-gray-400">›</span>
    </button>)}</div>
  </div>;
};
export default MenuManagement;
