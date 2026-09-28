export class AuditService{constructor(repo){this.repo=repo;} log(entry,client){return this.repo.log(entry,client);}}
