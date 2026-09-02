import { supabase, supabaseEnabled } from '../supabase';
import { User, Order, Prices, OrderItems, MenuItem, DailyMenuItem } from '../types';
const defaultNames:Record<string,string>={morningTea:'Morning Tea',lunchMeals:'Lunch: Meals',lunchEgg:'Lunch: Egg (add-on)',lunchFishMeat:'Lunch: Fish/Meat (add-on)',eveningTea:'Evening Tea'};
const isoDate=(date=new Date())=>date.toISOString().slice(0,10);
export async function loadSupabaseData(){
  if(!supabaseEnabled||!supabase)return null;
  const today=isoDate();
  const weekEnd=isoDate(new Date(new Date(`${today}T00:00:00`).getTime()+6*86400000));
  const[{data:profiles,error:pErr},{data:orders,error:oErr},{data:menu,error:mErr},{data:holidays,error:hErr},{data:dailyMenu,error:dmErr}]=await Promise.all([
    supabase.from('profiles').select('*'),
    supabase.from('orders').select('id,employee_id,ordered_for,status,created_at,updated_at,cancelled_at,order_source,guest_name,order_items(id,item_code,item_name,quantity,unit_price)').order('ordered_for',{ascending:false}),
    supabase.from('menu_prices').select('item_code,item_name,unit_price,active,archived,updated_at').order('item_code'),
    supabase.from('holidays').select('holiday_date,reason').order('holiday_date'),
    supabase.from('daily_menu').select('menu_date,item_code,item_name,unit_price,active,updated_at').gte('menu_date',today).lte('menu_date',weekEnd).order('menu_date').order('item_code')
  ]);
  if(pErr)throw pErr;if(oErr)throw oErr;if(mErr)throw mErr;if(hErr)throw hErr;if(dmErr)throw dmErr;
  const users:User[]=(profiles||[]).map((p:any)=>({id:p.employee_code||p.sr_number||p.id,name:p.full_name||'',mobile:p.mobile_number||'',password:'',role:p.role,status:p.status||'active',isFirstLogin:Boolean(p.is_first_login)}));
  const byUuid=new Map((profiles||[]).map((p:any)=>[p.id,p]));
  const mappedOrders:Order[]=(orders||[]).filter((o:any)=>o.status!=='cancelled').map((o:any)=>{
    const items:OrderItems={};const itemPrices:Record<string,number>={};const itemNames:Record<string,string>={};
    (o.order_items||[]).forEach((i:any)=>{if(Number(i.quantity)>0){items[i.item_code]=true;itemPrices[i.item_code]=Number(i.unit_price);itemNames[i.item_code]=i.item_name||defaultNames[i.item_code]||i.item_code;}});
    const ep:any=byUuid.get(o.employee_id);
    const source:o['order_source'] = o.order_source==='admin'?'admin':o.order_source==='guest'?'guest':'employee';
    return{id:o.id,employeeId:ep?.employee_code||ep?.sr_number||o.employee_id,date:o.ordered_for,items,itemPrices,itemNames,orderSource:source,guestName:o.guest_name||undefined};
  });
  const prices:Prices={morningTea:8,lunchMeals:40,lunchEgg:10,lunchFishMeat:25,eveningTea:8};
  const menuItems:MenuItem[]=(menu||[]).map((r:any)=>{if(r.item_code in prices)prices[r.item_code as keyof Prices]=Number(r.unit_price);return{itemCode:r.item_code,itemName:r.item_name||defaultNames[r.item_code]||r.item_code,unitPrice:Number(r.unit_price),active:Boolean(r.active),archived:Boolean(r.archived)}});
  const dailyMenus:DailyMenuItem[]=(dailyMenu||[]).map((r:any)=>({menuDate:String(r.menu_date),itemCode:r.item_code,itemName:r.item_name||defaultNames[r.item_code]||r.item_code,unitPrice:Number(r.unit_price),active:Boolean(r.active)}));
  return{users,orders:mappedOrders,prices,menuItems,dailyMenus,holidays:(holidays||[]).map((h:any)=>String(h.holiday_date))};
}
export async function saveEmployee(user:User){if(!supabaseEnabled||!supabase)return;const{data,error}=await supabase.functions.invoke('create-employee',{body:{employee_code:user.id,full_name:user.name,mobile_number:user.mobile||null,password:user.password}});if(error)throw error;if(data?.error)throw new Error(data.error)}
export async function resetEmployeePassword(employeeId:string,password:string){if(!supabaseEnabled||!supabase)return;const{data,error}=await supabase.functions.invoke('create-employee',{body:{action:'reset_password',employee_code:employeeId,password}});if(error)throw error;if(data?.error)throw new Error(data.error)}
export async function deleteEmployee(employeeId:string):Promise<'deleted'>{if(!supabaseEnabled||!supabase)return'deleted';const{error}=await supabase.from('profiles').update({status:'deleted'}).or(`employee_code.eq.${employeeId},sr_number.eq.${employeeId}`);if(error)throw error;return'deleted'}
export async function updateEmployee(user:User){if(!supabaseEnabled||!supabase)return;const{error}=await supabase.from('profiles').update({full_name:user.name,mobile_number:user.mobile||null,status:user.status||'active',is_first_login:Boolean(user.isFirstLogin)}).or(`employee_code.eq.${user.id},sr_number.eq.${user.id}`);if(error)throw error}
export async function upsertOrder(order:Order,prices:Prices){
  if(!supabaseEnabled||!supabase)return;
  const{data:profile,error:pe}=await supabase.from('profiles').select('id').or(`employee_code.eq.${order.employeeId},sr_number.eq.${order.employeeId}`).maybeSingle();
  if(pe)throw pe;if(!profile)throw new Error('Employee profile not found.');
  const{error:oe}=await supabase.from('orders').upsert({id:order.id,employee_id:profile.id,ordered_for:order.date,status:order.status||'active',order_source:order.orderSource||'employee',guest_name:order.orderSource==='guest'?(order.guestName?.trim()||null):null},{onConflict:'id'});if(oe)throw oe;
  const{error:de}=await supabase.from('order_items').delete().eq('order_id',order.id);if(de)throw de;
  const rows=Object.keys(order.items).filter(c=>order.items[c]).map(c=>({order_id:order.id,item_code:c,item_name:order.itemNames?.[c]||defaultNames[c]||c,quantity:1,unit_price:order.itemPrices?.[c]??(c in prices?prices[c as keyof Prices]:0)}));
  if(rows.length){const{error}=await supabase.from('order_items').insert(rows);if(error)throw error;}
}
export async function adminPlaceOrder(order:Order,prices:Prices){return upsertOrder({...order,orderSource:'admin'},prices)}
export async function cancelOrder(order:Order){if(!supabaseEnabled||!supabase)return;const{error}=await supabase.from('orders').update({status:'cancelled',cancelled_at:new Date().toISOString()}).eq('id',order.id);if(error)throw error}
export async function upsertPrices(prices:Prices,menuItems:MenuItem[]=[]){if(!supabaseEnabled||!supabase)return;const rows=menuItems.map(i=>({item_code:i.itemCode,item_name:i.itemName,unit_price:i.itemCode in prices?prices[i.itemCode as keyof Prices]:i.unitPrice,active:Boolean(i.active),archived:Boolean(i.archived)}));if(!rows.length)return;const{error}=await supabase.from('menu_prices').upsert(rows,{onConflict:'item_code'});if(error)throw error}
export async function saveMenuItem(item:MenuItem){if(!supabaseEnabled||!supabase)return;const{error}=await supabase.from('menu_prices').upsert({item_code:item.itemCode,item_name:item.itemName,unit_price:Number(item.unitPrice),active:Boolean(item.active),archived:Boolean(item.archived)},{onConflict:'item_code'});if(error)throw error}
export async function deactivateMenuItem(itemCode:string){if(!supabaseEnabled||!supabase)return;const{error}=await supabase.from('menu_prices').update({active:false}).eq('item_code',itemCode);if(error)throw error}
export async function activateMenuItem(itemCode:string){if(!supabaseEnabled||!supabase)return;const{error}=await supabase.from('menu_prices').update({active:true,archived:false}).eq('item_code',itemCode);if(error)throw error}
export async function deleteMenuItem(itemCode:string):Promise<'deleted'|'deactivated'>{if(!supabaseEnabled||!supabase)return'deactivated';const{error}=await supabase.from('menu_prices').update({active:false,archived:true}).eq('item_code',itemCode);if(error)throw error;return'deactivated'}
export async function upsertDailyMenu(menuDate:string,items:MenuItem[]){if(!supabaseEnabled||!supabase)return;const rows=items.map(i=>({menu_date:menuDate,item_code:i.itemCode,item_name:i.itemName.trim(),unit_price:Number(i.unitPrice),active:Boolean(i.active),updated_at:new Date().toISOString()}));if(!rows.length)return;const{error}=await supabase.from('daily_menu').upsert(rows,{onConflict:'menu_date,item_code'});if(error)throw error}
export async function deleteDailyMenu(menuDate:string){if(!supabaseEnabled||!supabase)return;const{error}=await supabase.from('daily_menu').delete().eq('menu_date',menuDate);if(error)throw error}
export async function getDailyMenu(menuDate:string):Promise<DailyMenuItem[]>{if(!supabaseEnabled||!supabase)return[];const{data,error}=await supabase.from('daily_menu').select('menu_date,item_code,item_name,unit_price,active').eq('menu_date',menuDate).order('item_code');if(error)throw error;return(data||[]).map((r:any)=>({menuDate:String(r.menu_date),itemCode:r.item_code,itemName:r.item_name,unitPrice:Number(r.unit_price),active:Boolean(r.active)}))}
export async function saveHoliday(holidayDate:string,reason=''){if(!supabaseEnabled||!supabase)return;const{error}=await supabase.from('holidays').upsert({holiday_date:holidayDate,reason:reason||null},{onConflict:'holiday_date'});if(error)throw error}
export async function removeHoliday(holidayDate:string){if(!supabaseEnabled||!supabase)return;const{error}=await supabase.from('holidays').delete().eq('holiday_date',holidayDate);if(error)throw error}
