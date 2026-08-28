export type Role = 'employee' | 'admin';
export type Status = 'active' | 'blocked';

export interface User {
    id: string; // SR Number for employees, 'admin' for admin
    name: string;
    mobile: string;
    password: string;
    role: Role;
    status: Status;
    isFirstLogin?: boolean;
}

export interface OrderItems {
    morningTea: boolean;
    lunchMeals: boolean;
    lunchEgg: boolean;
    lunchFishMeat: boolean;
    eveningTea: boolean;
}

export interface Order {
    id: string;
    employeeId: string;
    date: string;
    items: OrderItems;
}

export interface Prices {
    morningTea: number;
    lunchMeals: number;
    lunchEgg: number;
    lunchFishMeat: number;
    eveningTea: number;
}
