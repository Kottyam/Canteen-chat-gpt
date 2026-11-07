import React from 'react';
import { useGuestOrdersEnabled } from '../../hooks/usePoolingSpecials';

/** "Order for Me" / "Guest Order" tabs. The guest tab is hidden when the canteen turns Guest orders Off (all modes). */
const OrderModeTabs: React.FC<{ mode: 'me' | 'guest'; onMode: (m: 'me' | 'guest') => void }> = ({ mode, onMode }) => {
  const guestOn = useGuestOrdersEnabled();
  const tab = (m: 'me' | 'guest') => `min-h-11 rounded-lg px-3 py-2 text-sm font-semibold ${mode === m ? 'bg-white text-primary-700 shadow-sm' : 'text-gray-600'}`;
  return <div className={`grid ${guestOn ? 'grid-cols-2' : 'grid-cols-1'} gap-2 rounded-xl bg-gray-100 p-1`}>
    <button type="button" onClick={() => onMode('me')} className={tab('me')}>Order for Me</button>
    {guestOn && <button type="button" onClick={() => onMode('guest')} className={tab('guest')}>Guest Order</button>}
  </div>;
};
export default OrderModeTabs;
