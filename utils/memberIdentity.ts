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

const DELETED_MEMBER_PREFIX='Deleted Member';

/** Strip existing Deleted Member prefixes so historical labels are added exactly once. */
const normalizeDeletedMemberName=(name:string)=>name.replace(/^(?:Deleted Member\s*(?:—\s*|-)\s*)+/i,'').trim()||'Unknown';

/** Single user-facing historical Member identity rule. Never exposes technical IDs. */
export const memberDisplayName=(record?:MemberIdentityRecord|null)=>{
  if(!record)return 'Deleted Member';
  const name=record.member_name_snapshot||record.full_name||'';
  if(record.status==='deleted')return `${DELETED_MEMBER_PREFIX} — ${normalizeDeletedMemberName(name)}`;
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
  return status==='deleted'?`${DELETED_MEMBER_PREFIX} — ${normalizeDeletedMemberName(name)}`:name||'Member';
};
