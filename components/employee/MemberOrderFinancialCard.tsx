import React,{useMemo}from'react';
import{Order}from'../../types';
import{EmployeeAdjustment}from'../../services/employeeAdjustments';
import{orderFinancialPresentation,adjustmentFinancialPresentation}from'../../utils/orderFinancialPresentation';
import{useData}from'../../context/DataContext';

interface Props{
  order:Order;
  orderFor:'today'|'tomorrow';
  orderDate:string;
  adjustments:EmployeeAdjustment[];
  onViewOrder:()=>void;
}

const money=(value:number)=>value.toFixed(2);

const MemberOrderFinancialCard:React.FC<Props>=({order,orderFor,orderDate,adjustments,onViewOrder})=>{
  const{menuItems}=useData();
  const financial=useMemo(()=>orderFinancialPresentation(order),[order]);
  const memberItems=useMemo(()=>Object.keys(order.items||{}).filter(code=>order.items?.[code]).map(code=>({
    code,
    name:order.itemNames?.[code]??menuItems.find(i=>i.itemCode===code)?.itemName??code,
    qty:Math.max(1,Number(order.itemQuantities?.[code]||1)),
    total:Number(order.itemPrices?.[code]??menuItems.find(i=>i.itemCode===code)?.unitPrice??0)*Math.max(1,Number(order.itemQuantities?.[code]||1))
  })),[order,menuItems]);
  const guestItems=useMemo(()=>Object.keys(order.guestItems||{}).filter(code=>order.guestItems?.[code]).map(code=>({
    code,
    name:order.guestItemNames?.[code]??menuItems.find(i=>i.itemCode===code)?.itemName??code,
    qty:Math.max(1,Number(order.guestItemQuantities?.[code]||1)),
    total:Number(order.guestItemPrices?.[code]??menuItems.find(i=>i.itemCode===code)?.unitPrice??0)*Math.max(1,Number(order.guestItemQuantities?.[code]||1))
  })),[order,menuItems]);
  const adjustmentPresentation=useMemo(()=>adjustments.map(adjustment=>({...adjustment,...adjustmentFinancialPresentation(adjustment)})),[adjustments]);
  const adminAddedTotal=useMemo(()=>adjustmentPresentation.reduce((sum,row)=>sum+row.adminAddedAmount,0),[adjustmentPresentation]);
  const adjustmentCompanyContribution=useMemo(()=>adjustmentPresentation.reduce((sum,row)=>sum+row.companyContribution,0),[adjustmentPresentation]);
  const companyContribution=financial.companyContribution+adjustmentCompanyContribution;
  const memberTotal=financial.grossMemberFood+financial.grossGuestFood+adminAddedTotal-companyContribution;
  const title=orderFor==='tomorrow'?'Tomorrow’s Member Order':'Today’s Member Order';

  return <div className="mt-5 rounded-xl border bg-gray-50 p-4 sm:p-5">
    <div className="flex flex-col gap-1 border-b pb-3 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
      <div className="min-w-0">
        <p className="font-bold text-gray-800">{title}</p>
        <p className="text-sm text-primary-700">{orderDate} · {order.orderSource==='admin'?'Placed by Admin':'Placed'}</p>
      </div>
      <p className="text-lg font-bold text-primary-700 sm:text-xl">₹{money(memberTotal)}</p>
    </div>

    <div className="mt-4 space-y-3">
      {financial.grossMemberFood>0&&<section className="rounded-xl border bg-white p-4">
        <div className="flex items-start justify-between gap-3">
          <span className="font-semibold text-gray-700">Member Food</span>
          <span className="text-lg font-bold text-gray-900">₹{money(financial.grossMemberFood)}</span>
        </div>
        <div className="mt-2 space-y-1 text-sm text-gray-600">
          {memberItems.map(item=><div key={item.code} className="flex items-start justify-between gap-3"><span className="min-w-0 break-words">{item.name} × {item.qty}</span><span className="shrink-0 font-semibold">₹{money(item.total)}</span></div>)}
        </div>
        <div className="mt-3 flex items-center justify-between gap-3 border-t pt-2 text-sm font-bold text-gray-800">
          <span>Member Food Total</span><span>₹{money(financial.grossMemberFood)}</span>
        </div>
      </section>}      {financial.grossGuestFood>0&&      <section className="rounded-xl border bg-white p-4">
        <div className="flex items-start justify-between gap-3">
          <span className="font-semibold text-gray-700">Guest Food</span>
          <span className="text-lg font-bold text-gray-900">₹{money(financial.grossGuestFood)}</span>
        </div>
        {guestItems.length>0&&<div className="mt-2 space-y-1 text-sm text-gray-600">
          {guestItems.map(item=><div key={item.code} className="flex items-start justify-between gap-3"><span className="min-w-0 break-words">{item.name} × {item.qty}</span><span className="shrink-0 font-semibold">₹{money(item.total)}</span></div>)}
        </div>}
        <div className="mt-3 flex items-center justify-between gap-3 border-t pt-2 text-sm font-bold text-gray-800">
          <span>Guest Food Total</span><span>₹{money(financial.grossGuestFood)}</span>
        </div>
      </section>}

      {adminAddedTotal>0&&      <section className="rounded-xl border bg-white p-4">
        <div className="flex items-start justify-between gap-3">
          <span className="font-semibold text-gray-700">Admin Added</span>
          <span className="text-lg font-bold text-gray-900">₹{money(adminAddedTotal)}</span>
        </div>
        {adjustmentPresentation.length>0&&<div className="mt-2 space-y-2 text-sm text-gray-600">
          {adjustmentPresentation.map(row=><div key={row.id} className="flex items-start justify-between gap-3"><span className="min-w-0 break-words">{row.description?.trim()||'Added Amount'}</span><span className="shrink-0 font-semibold">₹{money(row.adminAddedAmount)}</span></div>)}
        </div>}
      </section>}

      {companyContribution>0&&      <section className="rounded-xl border bg-white p-4">
        <div className="flex items-start justify-between gap-3">
          <span className="font-semibold text-gray-700">Company Contribution</span>
          <span className="text-lg font-bold text-gray-900">-₹{money(companyContribution)}</span>
        </div>
      </section>}

      <section className="flex items-center justify-between gap-3 rounded-xl border bg-primary-50 p-4">
        <span className="font-semibold text-gray-800">Member Total</span>
        <span className="text-xl font-bold text-primary-700">₹{money(memberTotal)}</span>
      </section>
    </div>

    <button type="button" onClick={onViewOrder} className="mt-4 w-full rounded-lg bg-red-600 px-4 py-3 font-semibold text-white">View / Cancel Order</button>
  </div>;
};

export default MemberOrderFinancialCard;
