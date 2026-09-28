import { resolvePermission } from '../../core/permissions/PermissionResolver.js';
import { SUPER_ADMIN_PERMISSION, DM_TRIAL_PERMISSION } from '../../core/permissions/catalog.js';
import { AppError } from '../../core/errors/AppError.js';

export class PermissionService {
  constructor({ repo, ownerUserId, cacheTtlMs=8_000 }) {
    this.repo=repo;
    this.ownerUserId=String(ownerUserId);
    this.subjectGrantCache=new WeakMap();
    this.sharedGrantCache=new Map();
    this.dmCache=new Map();
    this.cacheTtlMs=cacheTtlMs;
  }
  isOwner(userId){ return String(userId)===this.ownerUserId; }
  _revision(){return this.repo?.getRevision?.()??this.repo?.revision??0;}
  _prune(map){if(map.size<500)return;const now=Date.now();for(const [k,v] of map)if(v.expiresAt<=now)map.delete(k);if(map.size>700)map.clear();}
  _grantKey(subject){const roles=[...(subject.roleIds??[])].map(String).sort().join(',');return `${subject.guildId}:${subject.userId}:${roles}:r${this._revision()}`;}
  async canUseDm({guildId,userId}){
    if(this.isOwner(userId)) return true;
    const key=`${guildId}:${userId}:r${this._revision()}`;
    const now=Date.now();const hit=this.dmCache.get(key);if(hit&&hit.expiresAt>now)return hit.value;
    const value=await this.repo.hasDirectUserPermission({guildId,userId,permission:DM_TRIAL_PERMISSION});
    this.dmCache.set(key,{value,expiresAt:now+this.cacheTtlMs});this._prune(this.dmCache);return value;
  }
  _hasDirectSuperAdmin(grants=[]){return grants.some((g)=>g.permission_key===SUPER_ADMIN_PERMISSION && g.effect==='allow' && g.scope_type==='global' && !g.scope_id && g.source==='user');}
  async grants(subject){
    if(this.isOwner(subject.userId)) return [];
    const revision=this._revision();
    if(subject&&typeof subject==='object'){
      const local=this.subjectGrantCache.get(subject);
      if(local?.revision===revision)return local.promise;
    }
    const key=this._grantKey(subject);const now=Date.now();const cached=this.sharedGrantCache.get(key);
    let promise;
    if(cached&&cached.expiresAt>now)promise=cached.promise;
    else{
      promise=this.repo.grantsFor({guildId:subject.guildId,userId:subject.userId,roleIds:subject.roleIds??[]});
      this.sharedGrantCache.set(key,{promise,expiresAt:now+this.cacheTtlMs});this._prune(this.sharedGrantCache);
      promise.catch(()=>this.sharedGrantCache.delete(key));
    }
    if(subject&&typeof subject==='object')this.subjectGrantCache.set(subject,{revision,promise});
    return promise;
  }
  async isSuperAdmin(subject){if(this.isOwner(subject.userId)) return false;const grants=await this.grants(subject);return this._hasDirectSuperAdmin(grants);}
  async has(subject,permission,context={}) {const {userId}=subject;if(this.isOwner(userId)) return true;const grants=await this.grants(subject);if(permission!==SUPER_ADMIN_PERMISSION && this._hasDirectSuperAdmin(grants)) return true;return resolvePermission({isOwner:false,grants,permission,context});}
  async hasPotential(subject,permission){if(this.isOwner(subject.userId)) return true;const grants=await this.grants(subject);if(permission!==SUPER_ADMIN_PERMISSION && this._hasDirectSuperAdmin(grants)) return true;const related=grants.filter(g=>g.permission_key===permission);if(!related.length)return false;const allowScopes=new Set(related.filter(g=>g.effect==='allow').map(g=>`${g.scope_type}:${g.scope_id??''}`));const denyScopes=new Set(related.filter(g=>g.effect==='deny').map(g=>`${g.scope_type}:${g.scope_id??''}`));for(const scope of allowScopes)if(!denyScopes.has(scope))return true;return false;}
  async hasAnyPotential(subject,permissions){if(this.isOwner(subject.userId)) return true;const grants=await this.grants(subject);if(this._hasDirectSuperAdmin(grants)) return true;const wanted=new Set(permissions);const grouped=new Map();for(const g of grants){if(!wanted.has(g.permission_key))continue;const key=`${g.permission_key}:${g.scope_type}:${g.scope_id??''}`;const state=grouped.get(key)??{allow:false,deny:false};state[g.effect==='deny'?'deny':'allow']=true;grouped.set(key,state);}return [...grouped.values()].some(x=>x.allow&&!x.deny);}
  async assert(subject,permission,context={}) {if(!await this.has(subject,permission,context)) throw new AppError('FORBIDDEN','ليس لديك صلاحية لتنفيذ هذا الإجراء.');}
  async assertPotential(subject,permission){if(!await this.hasPotential(subject,permission)) throw new AppError('FORBIDDEN','ليس لديك صلاحية للوصول إلى هذا القسم.');}
}
