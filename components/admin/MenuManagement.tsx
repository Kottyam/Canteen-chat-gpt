import React,{useEffect,useMemo,useState}from'react';
import{MenuItem}from'../../types';
import{getWeeklyMenu,saveWeeklyMenu}from'../../services/supabaseSync';
import{useData}from'../../context/DataContext';
import AsyncActionButton from'../common/AsyncActionButton';
import{useBillingSettings}from'../../hooks/useBillingSettings';
import{useAuth}from'../../context/AuthContext';
import{useCurrentSpecials,refreshCurrentSpecials,rupees}from'../../hooks/usePoolingSpecials';
import{parsePriceToPaise,savePoolingSpecialItem}from'../../services/poolingSpecials';

const DAYS=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

interface MenuManagementProps{initialWeekday?:number}
/** Optional "Add price?" for a Pooling menu item. Charged to whoever orders it; never taken from the pool. */
export const SpecialPriceFields:React.FC<{checked:boolean;price:string;disabled?:boolean;compact?:boolean;onChecked:(v:boolean)=>void;onPrice:(v:string)=>void}>=({checked,price,disabled,compact,onChecked,onPrice})=><div className="space-y-2">
  <label className="flex min-h-11 items-center gap-2 text-sm text-gray-700"><input type="checkbox" checked={checked} disabled={disabled} onChange={e=>onChecked(e.target.checked)} className="h-5 w-5"/>Add price?</label>
  {checked&&<div><div className="flex"><span className={`flex ${compact?'min-h-11':'min-h-12'} items-center rounded-l-lg border border-r-0 bg-white px-3 text-gray-600`}>₹</span><input type="text" inputMode="decimal" value={price} disabled={disabled} onChange={e=>onPrice(e.target.value)} aria-label="Item price" placeholder="Price" className={`${compact?'min-h-11 text-sm':'min-h-12 text-base'} w-full rounded-r-lg border px-3 text-right`}/></div><p className="mt-1 text-xs text-gray-500">Added to the bill of whoever orders it (guest items go to the member who ordered). Not taken from the pool.</p></div>}
</div>;
export const PriceLockedNote:React.FC=()=><p className="text-xs text-gray-500">Item prices can be added only by admins with payments permission.</p>;

const MenuManagement:React.FC<MenuManagementProps>=({initialWeekday})=>{
  const{menuItems}=useData();
  const{pooling}=useBillingSettings();
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
  const{hasPermission}=useAuth();
  // Special prices (Pooling only): payments admins only (server-enforced too)
  const canPrice=pooling&&hasPermission('payments');
  const current=useCurrentSpecials();
  const[draftSpecial,setDraftSpecial]=useState<Record<string,number|null>>({});
  const[newSpecial,setNewSpecial]=useState(false);const[newSpecialPrice,setNewSpecialPrice]=useState('');
  const[editSpecial,setEditSpecial]=useState(false);const[editSpecialPrice,setEditSpecialPrice]=useState('');
  const savedSpecial=selectedDay==null?{}:(current.weekly[selectedDay]||{});
  const specialOf=(code:string):number|undefined=>{if(code in draftSpecial){const v=draftSpecial[code];return v==null?undefined:v}return savedSpecial[code]};
  const dayLabel=selectedDay==null?'':DAYS[selectedDay];

  const loadDay=async(day:number)=>{
    setSelectedDay(day);setLoading(true);setMessage('');setEditingCode(null);setDraftSpecial({});setNewSpecial(false);setNewSpecialPrice('');
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
    const name=newName.trim();const priceText=pooling?(newPrice.trim()||'0'):newPrice.trim();
    if(pooling&&!name){setMessage('Please enter an item name.');return}
    if(!name&&!priceText){setMessage('Please enter item name and price.');return}
    if(!name){setMessage('Please enter an item name.');return}
    if(!priceText){setMessage('Please enter a price.');return}
    const price=Number(priceText);
    if(!Number.isFinite(price)||price<0){setMessage('Please enter a valid price.');return}
    let specialPaise:number|null=null;
    if(canPrice&&newSpecial){try{specialPaise=parsePriceToPaise(newSpecialPrice)}catch(e:any){setMessage(e.message);return}}
    const base=name.toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'')||'item';
    let code=base;let n=2;
    while(items.some(i=>i.itemCode===code)||menuItems.some(i=>i.itemCode===code)){code=base+'_'+n++}
    setItems(prev=>[...prev,{itemCode:code,itemName:name,unitPrice:price,active:true,archived:false}]);
    if(specialPaise!=null)setDraftSpecial(prev=>({...prev,[code]:specialPaise}));
    setNewName('');setNewPrice('');setNewSpecial(false);setNewSpecialPrice('');setMessage(specialPaise!=null?'Item added with price. Tap Save to keep it.':'');
  };

  const startEdit=(item:MenuItem)=>{
    setEditingCode(item.itemCode);setEditName(item.itemName);setEditPrice(String(item.unitPrice));setMessage('');const sp=specialOf(item.itemCode);setEditSpecial(sp!=null);setEditSpecialPrice(sp!=null?String(sp/100):'');
  };
  const cancelEdit=()=>{setEditingCode(null);setEditName('');setEditPrice('')};

  const saveEdit=()=>{
    if(!editingCode)return;
    const name=editName.trim();
    if(pooling){
      if(!name){setMessage('Please enter an item name.');return}
      if(canPrice){
        let next:number|null=null;
        if(editSpecial){try{next=parsePriceToPaise(editSpecialPrice)}catch(e:any){setMessage(e.message);return}}
        const code=editingCode;if(next!==(specialOf(code)??null))setDraftSpecial(prev=>({...prev,[code]:next}));
      }
      patch(editingCode,{itemName:name});cancelEdit();return}
    const priceText=editPrice.trim();
    if(!name&&!priceText){setMessage('Please enter item name and price.');return}
    if(!name){setMessage('Please enter an item name.');return}
    if(!priceText){setMessage('Please enter a price.');return}
    const price=Number(priceText);
    if(!Number.isFinite(price)||price<0){setMessage('Please enter a valid price.');return}
    patch(editingCode,{itemName:name,unitPrice:price});cancelEdit();setMessage('');
  };

  const remove=(code:string)=>{if(editingCode===code)cancelEdit();setItems(prev=>prev.filter(i=>i.itemCode!==code));if(canPrice&&specialOf(code)!=null)setDraftSpecial(prev=>({...prev,[code]:null}))};

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
      let priceError='';
      if(canPrice){
        for(const[code,val]of Object.entries(draftSpecial)){
          const keep=clean.some(i=>i.itemCode===code);
          try{await savePoolingSpecialItem(selectedDay,code,keep?(val as number|null):null)}catch(e:any){priceError=e?.message||'Price not saved.'}
        }
        setDraftSpecial({});void refreshCurrentSpecials().catch(()=>{});
      }
      const persisted=await getWeeklyMenu(selectedDay);
      if(priceError){setItems(persisted);setMessage('Menu saved, but a price was not saved: '+priceError);return}
      setItems(persisted);
      setDayCounts(prev=>{const n=[...prev];n[selectedDay]=persisted.length;return n});
      setMessage('Weekly menu saved successfully.');
    }catch(error){console.error(error);setMessage('Unable to save menu. Please try again.')}
    finally{setSaving(false)}
  };

  if(selectedDay!=null)return <div className="w-full min-w-0">
    <button type="button" onClick={()=>{setSelectedDay(null);setMessage('')}} className="mb-4 min-h-11 rounded-lg px-2 text-sm font-semibold text-primary-700 hover:bg-primary-50">← {pooling?'Menu':'Menu & Prices'}</button>
    <div className="mb-5"><h3 className="text-2xl font-bold text-primary-900">{dayLabel}</h3><p className="mt-1 text-sm text-gray-600">{activeItems.length} menu item{activeItems.length===1?'':'s'}</p></div>
    {message&&<div className="mb-4 rounded-lg bg-gray-50 p-3 text-sm text-gray-700">{message}</div>}
    {loading?<div className="rounded-xl border bg-gray-50 p-4 text-sm text-gray-600">Loading menu…</div>:<>
      <div className="mb-5"><h4 className="mb-3 text-base font-bold text-gray-800">Menu Items</h4><div className="space-y-2">
        {activeItems.map(item=>editingCode===item.itemCode?
          <div key={item.itemCode} className="rounded-2xl border bg-white p-3 shadow-sm">
            <div className="space-y-2">
              <input value={editName} disabled={saving} onChange={e=>setEditName(e.target.value)} aria-label="Item name" className="min-h-11 w-full rounded-lg border px-3 text-sm outline-none focus:border-primary-500"/>
              {canPrice&&<SpecialPriceFields checked={editSpecial} price={editSpecialPrice} disabled={saving} onChecked={setEditSpecial} onPrice={setEditSpecialPrice} compact/>}
              {pooling&&!canPrice&&<PriceLockedNote/>}
              {!pooling&&<div className="flex"><span className="flex min-h-11 items-center rounded-l-lg border border-r-0 bg-gray-50 px-3 text-gray-600">₹</span><input type="text" inputMode="decimal" value={editPrice} disabled={saving} onChange={e=>setEditPrice(e.target.value)} aria-label="Price" className="min-h-11 w-full rounded-r-lg border px-3 text-right text-sm outline-none focus:border-primary-500"/></div>}
              <div className="flex gap-2"><button type="button" disabled={saving} onClick={saveEdit} className="min-h-11 flex-1 rounded-lg bg-primary-600 px-4 font-semibold text-white shadow-sm">Save Edit</button><button type="button" disabled={saving} onClick={cancelEdit} className="min-h-11 flex-1 rounded-lg border px-4 font-semibold text-gray-700">Cancel</button></div>
            </div>
          </div>
        :
          <div key={item.itemCode} className="rounded-2xl border bg-white p-3 shadow-sm">
            <div className="flex items-center gap-2">
              <div className="min-w-0 flex-1"><div className="break-words text-sm font-medium text-gray-800">{item.itemName}</div>{!pooling?<div className="mt-1 text-sm font-semibold text-gray-700">₹{item.unitPrice}</div>:specialOf(item.itemCode)!=null&&<div className="mt-1 text-sm font-semibold text-amber-700">{rupees(specialOf(item.itemCode)!)} extra{item.itemCode in draftSpecial?' (unsaved)':''}</div>}</div>
              <button type="button" disabled={saving} title="Edit" aria-label={'Edit '+item.itemName} onClick={()=>startEdit(item)} className="min-h-11 min-w-11 rounded-lg border text-primary-700 hover:bg-primary-50">✎</button>
              <button type="button" disabled={saving} title="Delete" aria-label={'Delete '+item.itemName} onClick={()=>remove(item.itemCode)} className="min-h-11 min-w-11 rounded-lg border text-red-600 hover:bg-red-50">🗑</button>
            </div>
          </div>
        )}
        {!activeItems.length&&<div className="rounded-xl border border-dashed bg-gray-50 p-5 text-center text-sm text-gray-600">No menu added yet.</div>}
      </div></div>
      <div className="rounded-xl border bg-gray-50 p-3 sm:p-4"><h4 className="mb-3 text-base font-bold text-gray-800">Add Menu Item</h4><div className="space-y-2">
        <input value={newName} disabled={saving} onChange={e=>setNewName(e.target.value)} placeholder="Item name" className="min-h-12 w-full rounded-lg border px-3 text-base"/>
        {!pooling&&<div className="flex"><span className="flex min-h-12 items-center rounded-l-lg border border-r-0 bg-white px-4 text-gray-600">₹</span><input type="text" inputMode="decimal" value={newPrice} disabled={saving} onChange={e=>setNewPrice(e.target.value)} placeholder="Price" className="min-h-12 w-full rounded-r-lg border px-3 text-base"/></div>}
        {canPrice&&<SpecialPriceFields checked={newSpecial} price={newSpecialPrice} disabled={saving} onChecked={setNewSpecial} onPrice={setNewSpecialPrice}/>}
        {pooling&&!canPrice&&<PriceLockedNote/>}
        <button type="button" disabled={saving} onClick={add} className="min-h-12 w-full rounded-lg border border-primary-600 bg-white px-4 font-semibold text-primary-700">+ Add Menu Item</button>
      </div></div>
      <AsyncActionButton loading={saving} loadingLabel="Saving…" onClick={()=>void save()} className="mt-4 min-h-12 w-full rounded-lg bg-primary-600 px-4 font-semibold text-white shadow-sm">Save</AsyncActionButton>
    </>}
  </div>;

  return <div className="w-full min-w-0">
    <div className="mb-5"><h3 className="text-2xl font-bold text-primary-900">{pooling?'Menu':'Menu & Prices'}</h3><p className="mt-1 text-sm text-gray-600">{pooling?'Pooling mode: add items without prices. Monthly bills share the canteen\'s expenses.':'Configure the weekly menu for each day.'}</p></div>
    <div className="space-y-3">{DAYS.map((day,index)=><button key={day} type="button" onClick={()=>void loadDay(index)} className="flex min-h-20 w-full items-center justify-between rounded-2xl border bg-white p-4 text-left shadow-sm transition hover:border-primary-300 hover:bg-primary-50">
      <span><span className="block text-base font-bold text-gray-800">{day}</span><span className="mt-1 block text-sm text-gray-600">{dayCounts[index]>0?dayCounts[index]+' menu item'+(dayCounts[index]===1?'':'s'):'No menu added'}</span></span><span className="text-xl text-gray-400">›</span>
    </button>)}</div>
  </div>;
};
export default MenuManagement;
