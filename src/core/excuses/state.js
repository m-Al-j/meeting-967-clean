import { AppError } from '../errors/AppError.js';
export const EXCUSE_STATUS = Object.freeze({ PENDING:'pending', APPROVED:'approved', REJECTED:'rejected' });
export function assertExcuseDecision(current, next) {
  if (current !== 'pending' || !['approved','rejected'].includes(next)) {
    throw new AppError('INVALID_EXCUSE_TRANSITION', 'لا يمكن تغيير حالة هذا الاعتذار بهذه الطريقة.');
  }
  return true;
}
