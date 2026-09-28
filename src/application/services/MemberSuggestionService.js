import {rankSmartMemberOptions} from '../../interfaces/discord/smartMemberRanking.js';

export class MemberSuggestionService {
  constructor({logger}={}){this.logger=logger;}

  async suggestions({options,query='',limit=25}){
    // Suggestions intentionally depend only on the text typed by the user and
    // the member's current display name / Discord username.
    return rankSmartMemberOptions(options,query,[],{limit});
  }

  // Kept as a harmless compatibility no-op for any older call-sites.
  // v1.3.8 no longer learns from whom the operator selected previously.
  async recordSelection(){return false;}
}
