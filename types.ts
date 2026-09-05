export type Role = 'employee' | 'admin';
export type AdminRole = 'owner' | 'staff_admin';
export type Status = 'active' | 'blocked' | 'deleted';
export interface User { id:string; name:string; mobile:string; password:string; role:Role; adminRole?:AdminRole; status:Status; isFirstLogin?:boolean; canteenId?:string; canteenName?:string; needsCanteenSetup?:boolean; authProvider?:'password'|'google'; memberLoginMode?:'sr'|'mobile'; }
export interface MenuItem { itemCode:string; itemName:string; unitPrice:number; active:boolean; archived?:boolean; }
export interface DailyMenuItem extends MenuItem { menuDate:string; }
export type OrderItems=Record<string,boolean>;
export type OrderItemPrices=Record<string,number>;
export type OrderItemNames=Record<string,string>;
export type GuestOrderItems=Record<string,boolean>;
export type GuestOrderQuantities=Record<string,number>;
export type OrderSource='employee'|'admin'|'guest';
export interface Order { id:string; employeeId:string; date:string; items:OrderItems; itemQuantities?:Record<string,number>; itemPrices?:OrderItemPrices; itemNames?:Record<string,string>; guestItems?:GuestOrderItems; guestItemQuantities?:Record<string,number>; guestItemPrices?:Record<string,number>; guestItemNames?:Record<string,string>; orderSource?:OrderSource; guestName?:string; guestCount?:number; guestTotal?:number; status?:'active'|'cancelled'; cancelledAt?:string; }
export type Prices={morningTea:number;lunchMeals:number;lunchEgg:number;lunchFishMeat:number;eveningTea:number;};
