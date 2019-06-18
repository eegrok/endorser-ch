import util from 'util'
import R from 'ramda'

import l from '../../common/logger';
import db from './endorser.db.service';
import { buildConfirmationList } from './util'

class OrgService {

  async getClaimsAndConfirmationsOnDate(orgName, roleName, onDateStr) {
    l.info(`${this.constructor.name}.getClaimsAndConfirmationsOnDate(${orgName}, ${roleName}, ${onDateStr})`);
    // Note that this is very similar to ActionService.getActionClaimsAndConfirmationsForEventsSince & TenureService.getClaimsAndConfirmationsAtPoint


    // retrieve "cac" (claim and confirmations), eg [{ orgRole: { ORGROLE DATA }, confirmation: { ISSUER & ROW DATA }|null }, ...]
    let cacs = await db.retrieveOrgRoleClaimsAndConfirmationsOnDate(orgName, roleName, onDateStr)

var util = require('util')
    // group by DID, eg {did1: [ ALL CACS FOR did1 ], did2: ...}
    let cacListsByDid = R.groupBy(cac => cac.orgRole.memberDid)(cacs)
    console.log("cacListsByDid",util.inspect(cacListsByDid, {depth:null}))
    // group by DID & orgRole ID, eg {did1: {orgRoleId1: [ CACS FOR did1 & orgRoleId1 ], orgRoleId2: ...}, did2: ...}
    let cacListsByDidThenOrgRole = R.map(cacList => R.groupBy(cac => cac.orgRole.id)(cacList))(cacListsByDid)
    console.log("cacListsByDidThenOrgRole",util.inspect(cacListsByDidThenOrgRole, {depth:null}))
    // aggregate all confirmations for each DID-orgRole
    // eg {did1: {orgRoleId1: { "orgRole": { ORGROLE DATA }, "confirmations": [ { ISSUER & ROW DATA }, ... ] }, orgRoleId2: ...}, did2: ...}
    let cacObjectByDid = R.map(R.map(R.curry(buildConfirmationList)('orgRole')))(cacListsByDidThenOrgRole)
    // strip the values from the orgRole ID keys
    // eg {did1: [ { "orgRole": { ORGROLE DATA }, "confirmations": [ { ISSUER & ROW DATA }, ... ] } ], did2: ...}
    let cacListByDid = R.map(R.values)(cacObjectByDid)
    console.log("cacListByDid",util.inspect(cacListByDid, {depth:null}))
    // create an array with "did" as key
    // eg [ {"did": did1, "orgRoles": [ VALUES FROM PREV ] }, ... ]
    var result = []
    for (let key of R.keys(cacListByDid)) {
      result.push({did:key, orgRoles:cacListByDid[key]})
    }
    return result
  }

}

export default new OrgService();
