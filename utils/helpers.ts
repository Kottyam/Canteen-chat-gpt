
export const formatDate = (date: Date): string => {
    return date.toISOString().split('T')[0];
};

export const getMonthName = (monthIndex: number): string => {
    const monthNames = ["January", "February", "March", "April", "May", "June",
      "July", "August", "September", "October", "November", "December"
    ];
    return monthNames[monthIndex];
};
   