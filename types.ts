export type Role = 'employee' | 'admin';
export type Status = 'active' | 'blocked' | 'deleted';

export interface User {
  id: string;
  name: string;
  mobile: string;
  password: string;
  role: Role;
  status: Status;
  isFirstLogin?: boolean;
}

export interface MenuItem {
  itemCode: string;
  itemName: string;
  unitPrice: number;
  active: boolean;
  archived?: boolean;
}

export interface DailyMenuItem extends MenuItem {
  menuDate: string;
}

export interface OrderItems {
  morningTea: boolean;
  lunchMeals: boolean;
  lunchEgg: boolean;
  lunchFishMeat: boolean;
  eveningTea: boolean;
}

export type OrderItemPrices = Partial<Record<keyof OrderItems, number>>;
export type OrderItemNames = Partial<Record<keyof OrderItems, string>>;

export interface Order {
  id: string;
  employeeId: string;
  date: string;
  items: OrderItems;
  itemPrices?: OrderItemPrices;
  itemNames?: OrderItemNames;
}

export type Prices = {
  morningTea: number;
  lunchMeals: number;
  lunchEgg: number;
  lunchFishMeat: number;
  eveningTea: number;
};
