import { AppError } from '../errors/AppError.js';
export const MEETING_STATUS = Object.freeze({UPCOMING:'upcoming',ONGOING:'ongoing',ENDED:'ended',CANCELED:'canceled',POSTPONED:'postponed'});
const allowed={upcoming:new Set(['ongoing','canceled','postponed']),postponed:new Set(['upcoming','ongoing','canceled']),ongoing:new Set(['ended']),ended:new Set(),canceled:new Set()};
export function assertMeetingTransition(from,to){if(!allowed[from]?.has(to))throw new AppError('INVALID_MEETING_TRANSITION',`لا يمكن تغيير حالة الاجتماع من ${from} إلى ${to}.`);return true;}
