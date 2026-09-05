export type MemberIdentityRecord={
  full_name?:string|null;
  mobile_number?:string|null;
  status?:string|null;
  member_name_snapshot?:string|null;
  member_mobile_snapshot?:string|null;
  employee_code?:string|null;
  sr_number?:string|null;
  id?:string|null;
};

/** Single user-facing historical Member identity rule. Never exposes technical IDs. */
export const memberDisplayName=(record?:MemberIdentityRecord|null)=>{
  if(!record)return 'Deleted Member';
  const name=record.member_name_snapshot||record.full_name||'';
  if(record.status==='deleted' || Boolean(record.member_name_snapshot&&record.status==='deleted')) return `Deleted Member — ${name||'Unknown'}`;
  return name||'Member';
};

export const memberDisplayMobile=(record?:MemberIdentityRecord|null)=>record?.member_mobile_snapshot||record?.mobile_number||'';

export const memberDisplayIdentity=(record?:MemberIdentityRecord|null)=>({
  name:memberDisplayName(record),
  mobile:memberDisplayMobile(record),
});

/** For historical records, snapshots win; technical IDs are never a UI fallback. */
export const historicalMemberName=(snapshot?:string|null,currentName?:string|null,status?:string|null)=>{
  const name=snapshot||currentName||'';
  return status==='deleted'?`Deleted Member — ${name||'Unknown'}`:name||'Member';
};
