export type Role = 'employee' | 'admin';
export type Status = 'active' | 'blocked' | 'deleted';
export interface User { id:string; name:string; mobile:string; password:string; role:Role; status:Status; isFirstLogin?:boolean; }
export interface MenuItem { itemCode:string; itemName:string; unitPrice:number; active:boolean; archived?:boolean; }
export interface DailyMenuItem extends MenuItem { menuDate:string; }
export type OrderItems=Record<string,boolean>;
export type OrderItemPrices=Record<string,number>;
export type OrderItemNames=Record<string,string>;
export type GuestOrderItems=Record<string,boolean>;
export type GuestOrderQuantities=Record<string,number>;
export type OrderSource='employee'|'admin'|'guest';
export interface Order { id:string; employeeId:string; date:string; items:OrderItems; itemPrices?:OrderItemPrices; itemNames?:OrderItemNames; guestItems?:GuestOrderItems; guestItemQuantities?:GuestOrderQuantities; guestItemPrices?:OrderItemPrices; guestItemNames?:OrderItemNames; orderSource?:OrderSource; guestName?:string; status?:'active'|'cancelled'; cancelledAt?:string; }
export type Prices={morningTea:number;lunchMeals:number;lunchEgg:number;lunchFishMeat:number;eveningTea:number;};
